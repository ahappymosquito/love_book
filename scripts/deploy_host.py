"""按 deploy/hosts.toml 的命名 SSH 主机做打包检查、连通性探测和生产发布，供智能体自动走完发布流程。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOSTS_FILE = PROJECT_ROOT / "deploy" / "hosts.toml"
DEFAULT_LOCAL_HOSTS_FILE = PROJECT_ROOT / "deploy" / "hosts.local.toml"
HOSTS_ENV = "LOVE_BOOK_DEPLOY_HOSTS"
LOCAL_HOSTS_ENV = "LOVE_BOOK_DEPLOY_HOSTS_LOCAL"
VERSION_SCRIPT = PROJECT_ROOT / "scripts" / "version.py"

NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
UNIX_PATH_PATTERN = re.compile(r"^/[\w./-]+$")
URL_PATTERN = re.compile(r"^https://[^\s]+$")
ALLOWED_CAPABILITIES = frozenset({"check", "status", "update", "backup", "run"})
ALLOWED_UPDATE_STYLES = frozenset({"updater", "none"})
REQUIRED_PACKAGE_FILES = (
    "Dockerfile",
    "web/Dockerfile",
    "docker-compose.yml",
    "deploy/caddy/Caddyfile",
    "deploy/hosts.toml",
    "VERSION",
    "CHANGELOG.md",
    "pyproject.toml",
    "poetry.lock",
    "web/package.json",
    "web/package-lock.json",
)


class DeployHostError(RuntimeError):
    """命名 SSH 主机配置无效，或远程发布步骤失败。"""


@dataclass(frozen=True)
class DeployHost:
    """一份可被智能体按名字选用的 SSH 发布目标。"""

    name: str
    ssh_alias: str
    user: str
    role: str
    label: str
    compose_dir: str
    health_url: str
    site_url: str
    update_style: str
    update_command: str
    update_host: str
    backup_command: str
    backup_root: str
    backend_image: str
    frontend_image: str
    connect_timeout: int
    capabilities: tuple[str, ...]
    notes: str


@dataclass(frozen=True)
class HostCatalog:
    """命名主机表，以及智能体未指定主机时的默认项。"""

    default_host: str
    hosts: dict[str, DeployHost]
    source: Path


def posix_quote(value: str) -> str:
    """按 POSIX 单引号规则引用远程命令参数，避免 Windows shlex.quote 改用双引号。"""
    return "'" + value.replace("'", "'\"'\"'") + "'"


def read_toml(path: Path) -> dict[str, Any]:
    try:
        import tomllib
    except ImportError as exc:  # pragma: no cover - Python 3.11+ is required
        raise DeployHostError("Python 3.11+ is required to read deploy/hosts.toml") from exc
    try:
        with path.open("rb") as handle:
            payload = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise DeployHostError(f"Cannot read host catalog {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise DeployHostError(f"{path} must contain a TOML table")
    return payload


def merge_catalog_dicts(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    if "default_host" in overlay:
        merged["default_host"] = overlay["default_host"]
    hosts = dict(base.get("hosts") or {})
    overlay_hosts = overlay.get("hosts") or {}
    if not isinstance(hosts, dict) or not isinstance(overlay_hosts, dict):
        raise DeployHostError("hosts must be a table of named SSH targets")
    for name, spec in overlay_hosts.items():
        if not isinstance(spec, dict):
            raise DeployHostError(f"Host {name!r} must be a table")
        current = dict(hosts.get(name) or {})
        current.update(spec)
        hosts[name] = current
    merged["hosts"] = hosts
    return merged


def _require_name(value: str, field: str) -> str:
    if not NAME_PATTERN.fullmatch(value):
        raise DeployHostError(f"{field} must be a SSH-safe identifier, got {value!r}")
    return value


def _optional_text(spec: dict[str, Any], field: str) -> str:
    value = spec.get(field, "")
    if value is None:
        return ""
    if not isinstance(value, str):
        raise DeployHostError(f"{field} must be a string")
    if "\n" in value and field not in {"notes"}:
        raise DeployHostError(f"{field} cannot contain newlines")
    return value.strip()


def _require_unix_path(value: str, field: str) -> str:
    if not UNIX_PATH_PATTERN.fullmatch(value):
        raise DeployHostError(f"{field} must be an absolute Unix path, got {value!r}")
    return value


def _require_https_url(value: str, field: str) -> str:
    if not URL_PATTERN.fullmatch(value):
        raise DeployHostError(f"{field} must be an https:// URL, got {value!r}")
    return value


def parse_host(name: str, spec: dict[str, Any]) -> DeployHost:
    _require_name(name, "host name")
    ssh_alias = _require_name(_optional_text(spec, "ssh_alias") or name, "ssh_alias")
    user = _optional_text(spec, "user")
    if not user:
        raise DeployHostError(f"Host {name} is missing user")
    compose_dir = _require_unix_path(_optional_text(spec, "compose_dir"), "compose_dir")
    health_url = _require_https_url(_optional_text(spec, "health_url"), "health_url")
    site_url = _require_https_url(_optional_text(spec, "site_url") or health_url.rsplit("/", 1)[0] + "/", "site_url")
    update_style = _optional_text(spec, "update_style") or "none"
    if update_style not in ALLOWED_UPDATE_STYLES:
        raise DeployHostError(f"Host {name} has unsupported update_style {update_style!r}")
    update_command = _optional_text(spec, "update_command")
    if "\n" in update_command:
        raise DeployHostError("update_command cannot contain newlines")
    if update_style == "updater" and not update_command:
        raise DeployHostError(f"Host {name} uses update_style=updater but has no update_command")
    update_host = _optional_text(spec, "update_host")
    if update_host:
        _require_name(update_host, "update_host")
    capabilities_raw = spec.get("capabilities", ["check", "status", "run"])
    if not isinstance(capabilities_raw, list) or not all(isinstance(item, str) for item in capabilities_raw):
        raise DeployHostError(f"Host {name} capabilities must be a list of strings")
    capabilities = tuple(item.strip() for item in capabilities_raw)
    unknown = [item for item in capabilities if item not in ALLOWED_CAPABILITIES]
    if unknown:
        raise DeployHostError(f"Host {name} has unknown capabilities: {unknown}")
    timeout = spec.get("connect_timeout", 20)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout < 1:
        raise DeployHostError(f"Host {name} connect_timeout must be a positive integer")
    backup_root = _optional_text(spec, "backup_root")
    if backup_root:
        _require_unix_path(backup_root, "backup_root")
    return DeployHost(
        name=name,
        ssh_alias=ssh_alias,
        user=user,
        role=_optional_text(spec, "role") or "production",
        label=_optional_text(spec, "label") or name,
        compose_dir=compose_dir,
        health_url=health_url,
        site_url=site_url,
        update_style=update_style,
        update_command=update_command,
        update_host=update_host,
        backup_command=_optional_text(spec, "backup_command"),
        backup_root=backup_root,
        backend_image=_optional_text(spec, "backend_image") or "ghcr.io/ahappymosquito/love_book-backend:latest",
        frontend_image=_optional_text(spec, "frontend_image") or "ghcr.io/ahappymosquito/love_book-frontend:latest",
        connect_timeout=timeout,
        capabilities=capabilities,
        notes=_optional_text(spec, "notes"),
    )


def load_catalog(hosts_file: Path | None = None, local_file: Path | None = None) -> HostCatalog:
    source = Path(os.environ.get(HOSTS_ENV, hosts_file or DEFAULT_HOSTS_FILE))
    if not source.is_file():
        raise DeployHostError(f"Host catalog not found: {source}")
    payload = read_toml(source)
    overlay_path = Path(os.environ.get(LOCAL_HOSTS_ENV, local_file or DEFAULT_LOCAL_HOSTS_FILE))
    if overlay_path.is_file():
        payload = merge_catalog_dicts(payload, read_toml(overlay_path))
    raw_hosts = payload.get("hosts")
    if not isinstance(raw_hosts, dict) or not raw_hosts:
        raise DeployHostError(f"{source} must define at least one [hosts.NAME] table")
    hosts: dict[str, DeployHost] = {}
    for name, spec in raw_hosts.items():
        if not isinstance(spec, dict):
            raise DeployHostError(f"Host {name!r} must be a table")
        hosts[name] = parse_host(name, spec)
    default_host = str(payload.get("default_host") or next(iter(hosts)))
    if default_host not in hosts:
        raise DeployHostError(f"default_host {default_host!r} is not defined")
    for host in hosts.values():
        if host.update_host and host.update_host not in hosts:
            raise DeployHostError(f"Host {host.name} update_host {host.update_host!r} is not defined")
    return HostCatalog(default_host=default_host, hosts=hosts, source=source)


def resolve_host(catalog: HostCatalog, name: str | None) -> DeployHost:
    chosen = name or catalog.default_host
    host = catalog.hosts.get(chosen)
    if host is None:
        known = ", ".join(sorted(catalog.hosts))
        raise DeployHostError(f"Unknown SSH host {chosen!r}. Configured hosts: {known}")
    return host


def ssh_executable() -> str:
    path = shutil.which("ssh")
    if not path:
        raise DeployHostError("ssh is not on PATH; install OpenSSH Client")
    return path


def bash_login_command(script: str) -> str:
    """把多行远程脚本交给 bash -lc，避免依赖登录 shell 如何拼接 ssh 参数。"""
    return "bash -lc " + posix_quote(script)


def build_ssh_argv(host: DeployHost, remote_command: str, *, tty: bool = False) -> list[str]:
    argv = [
        ssh_executable(),
        "-o", "BatchMode=yes",
        "-o", f"ConnectTimeout={host.connect_timeout}",
        "-o", "IdentitiesOnly=yes",
    ]
    if tty:
        argv.append("-t")
    argv.extend([host.ssh_alias, remote_command])
    return argv


def run_command(argv: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def run_ssh(host: DeployHost, remote_command: str, *, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    argv = build_ssh_argv(host, remote_command)
    limit = timeout if timeout is not None else max(60, host.connect_timeout + 30)
    try:
        result = run_command(argv, timeout=limit)
    except subprocess.TimeoutExpired as exc:
        raise DeployHostError(f"SSH to {host.ssh_alias} timed out after {limit}s") from exc
    return result


def require_success(result: subprocess.CompletedProcess[str], failure: str) -> None:
    if result.returncode == 0:
        return
    detail = (result.stderr or result.stdout or "").strip()
    if detail:
        raise DeployHostError(f"{failure}\n{detail}")
    raise DeployHostError(failure)


def host_has(host: DeployHost, capability: str) -> bool:
    return capability in host.capabilities


def check_script(host: DeployHost) -> str:
    compose_file = f"{host.compose_dir}/docker-compose.yml"
    updater = f"{host.compose_dir}/update.sh"
    lines = [
        "set -euo pipefail",
        "echo USER=$(id -un)",
        "echo HOME=$HOME",
        f"test -d {posix_quote(host.compose_dir)}",
        f"test -f {posix_quote(compose_file)}",
        "command -v docker >/dev/null",
        "docker compose version >/dev/null",
        "echo DOCKER_OK",
    ]
    if host.update_style == "updater":
        lines.append(f"test -x {posix_quote(updater)} || test -f {posix_quote(updater)}")
        lines.append("echo UPDATER_PRESENT")
    if host.backup_command:
        backup_bin = host.backup_command.split()[0]
        if backup_bin.startswith("/"):
            lines.append(f"test -x {posix_quote(backup_bin)}")
            lines.append("echo BACKUP_OK")
    lines.append("echo CHECK_OK")
    return "\n".join(lines)


def status_script(host: DeployHost) -> str:
    return "\n".join(
        [
            "set -euo pipefail",
            f"cd {posix_quote(host.compose_dir)}",
            "docker compose ps",
            "echo --- images ---",
            "docker compose images",
            "echo --- health ---",
            f"curl -fsS {posix_quote(host.health_url)} || echo HEALTH_UNAVAILABLE",
        ]
    )


def print_stream(text: str) -> None:
    if text:
        sys.stdout.write(text if text.endswith("\n") else text + "\n")


def cmd_list(catalog: HostCatalog) -> int:
    print(f"default_host={catalog.default_host}")
    print(f"source={catalog.source}")
    for name in sorted(catalog.hosts):
        host = catalog.hosts[name]
        marker = "*" if name == catalog.default_host else " "
        caps = ",".join(host.capabilities)
        print(f"{marker} {name:16} alias={host.ssh_alias:16} user={host.user:8} {host.label} [{caps}]")
    return 0


def cmd_show(host: DeployHost) -> int:
    payload = {
        "name": host.name,
        "label": host.label,
        "ssh_alias": host.ssh_alias,
        "user": host.user,
        "role": host.role,
        "compose_dir": host.compose_dir,
        "health_url": host.health_url,
        "site_url": host.site_url,
        "update_style": host.update_style,
        "update_command": host.update_command,
        "update_host": host.update_host or None,
        "backup_command": host.backup_command or None,
        "backup_root": host.backup_root or None,
        "backend_image": host.backend_image,
        "frontend_image": host.frontend_image,
        "connect_timeout": host.connect_timeout,
        "capabilities": list(host.capabilities),
        "notes": host.notes,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_check(host: DeployHost) -> int:
    result = run_ssh(host, bash_login_command(check_script(host)), timeout=host.connect_timeout + 40)
    print_stream(result.stdout)
    require_success(result, f"SSH check failed for {host.name} ({host.ssh_alias})")
    print(f"SSH host {host.name} is ready as {host.user}@{host.ssh_alias}")
    return 0


def cmd_status(host: DeployHost) -> int:
    result = run_ssh(host, bash_login_command(status_script(host)), timeout=host.connect_timeout + 60)
    print_stream(result.stdout)
    require_success(result, f"Status failed for {host.name} ({host.ssh_alias})")
    local_health = fetch_health(host.health_url)
    if local_health:
        print(f"local_health={local_health}")
    return 0


def fetch_health(url: str) -> str:
    try:
        with urlopen(url, timeout=15) as response:  # noqa: S310 - operator-configured HTTPS health URL
            return response.read().decode("utf-8", errors="replace").strip()
    except (URLError, OSError, TimeoutError, ValueError):
        return ""


def run_version_check(tag: str | None = None) -> str:
    command = [sys.executable, str(VERSION_SCRIPT), "check"]
    if tag:
        command.extend(["--tag", tag])
    result = run_command(command, timeout=30)
    require_success(result, "Application version check failed")
    return (result.stdout or "").strip()


def cmd_package(tag: str | None) -> int:
    print("===== 打包前检查 =====")
    version_output = run_version_check(tag)
    print(version_output)
    missing = [rel for rel in REQUIRED_PACKAGE_FILES if not (PROJECT_ROOT / rel).is_file()]
    if missing:
        raise DeployHostError("Missing required packaging files:\n- " + "\n- ".join(missing))
    print("required_files=ok")
    version = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    print(f"package_version={version}")
    print("下一步（推送标签和发布镜像需要当次明确授权）：")
    print(f"  git tag -a v{version} -m \"Love Book {version}\"")
    print(f"  git push origin v{version}")
    print("  等待 GitHub Actions release-images 成功")
    print("  python scripts/deploy_host.py check --host ts3_qrqto")
    print("  python scripts/deploy_host.py update --host root_qrqto --yes")
    return 0


def cmd_recipe(catalog: HostCatalog) -> int:
    print(
        f"""Love Book 智能体打包到发布

1. 只有正式发布才改 VERSION / CHANGELOG，并运行 python scripts/version.py sync
2. python scripts/deploy_host.py package --tag vX.Y.Z
3. 运行后端测试和前端生产构建
4. 经用户明确授权后创建并推送 annotated tag vX.Y.Z
5. 等待 GitHub Actions 构建同版本前后端镜像并提升 latest
6. python scripts/deploy_host.py check --host {catalog.default_host}
7. python scripts/deploy_host.py status --host {catalog.default_host}
8. python scripts/deploy_host.py update --host root_qrqto --yes
   （若坚持从默认主入口发布：python scripts/deploy_host.py update --host {catalog.default_host} --follow-update-host --yes）
9. curl -fsS https://qrqto.club/api/health  确认 version 与 VERSION 一致

命名主机来自 {catalog.source}。本机额外主机写 deploy/hosts.local.toml。
私钥只放 ~/.ssh/config 的 Host 条目，例如 ts3_qrqto、root_qrqto。
""".strip()
    )
    return 0


def resolve_update_host(catalog: HostCatalog, host: DeployHost, follow: bool) -> DeployHost:
    if host_has(host, "update") and host.update_style == "updater":
        return host
    if host.update_host:
        target = catalog.hosts[host.update_host]
        if follow:
            return target
        raise DeployHostError(
            f"Host {host.name} cannot publish by itself; it has no update capability. "
            f"Use --host {host.update_host} or pass --follow-update-host.\n"
            f"Example: python scripts/deploy_host.py update --host {host.update_host} --yes"
        )
    raise DeployHostError(f"Host {host.name} has no update capability and no update_host")


def cmd_update(
    catalog: HostCatalog,
    host: DeployHost,
    *,
    yes: bool,
    dry_run: bool,
    follow: bool,
) -> int:
    target = resolve_update_host(catalog, host, follow)
    if target.name != host.name:
        print(f"update_host_follow {host.name} -> {target.name}")
    if not host_has(target, "update"):
        raise DeployHostError(f"Host {target.name} is not allowed to run production updates")
    remote = target.update_command
    argv = build_ssh_argv(target, remote)
    print(f"ssh_alias={target.ssh_alias}")
    print(f"remote={remote}")
    if dry_run:
        print("dry_run=true")
        print("ssh " + " ".join(posix_quote(part) if " " in part else part for part in argv[1:]))
        return 0
    if not yes:
        raise DeployHostError(
            "Refusing to run a production update without --yes. "
            "Re-run with --dry-run to print the command, or --yes after explicit authorization."
        )
    result = run_ssh(target, remote, timeout=max(300, target.connect_timeout + 240))
    print_stream(result.stdout)
    require_success(result, f"Production update failed on {target.name}")
    print_stream(result.stderr)
    health = fetch_health(target.health_url)
    if health:
        print(f"local_health={health}")
    print(f"Update finished via {target.name}")
    return 0


def cmd_run(host: DeployHost, remote_parts: list[str]) -> int:
    if not remote_parts:
        raise DeployHostError("run requires a remote command after --")
    if not host_has(host, "run"):
        raise DeployHostError(f"Host {host.name} is not allowed to run arbitrary remote commands")
    remote = " ".join(posix_quote(part) if re.search(r"[\s\"']", part) else part for part in remote_parts)
    result = run_ssh(host, remote, timeout=max(120, host.connect_timeout + 60))
    print_stream(result.stdout)
    print_stream(result.stderr)
    require_success(result, f"Remote command failed on {host.name}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hosts-file", type=Path, help="override deploy/hosts.toml")
    parser.add_argument("--local-hosts-file", type=Path, help="override deploy/hosts.local.toml")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="列出已配置的命名 SSH 主机")
    subparsers.add_parser("recipe", help="打印智能体打包到发布步骤")

    show = subparsers.add_parser("show", help="显示一个命名主机的完整参数")
    show.add_argument("--host", help="命名主机，默认 default_host")

    check = subparsers.add_parser("check", help="BatchMode SSH 探测目录、Docker 和更新器")
    check.add_argument("--host", help="命名主机，默认 default_host")

    status = subparsers.add_parser("status", help="查看远程 Compose 状态和健康检查")
    status.add_argument("--host", help="命名主机，默认 default_host")

    package = subparsers.add_parser("package", help="本地打包前检查版本和必要文件")
    package.add_argument("--tag", help="正式发布标签，例如 v0.9.0")

    update = subparsers.add_parser("update", help="通过具备更新能力的主机执行生产更新器")
    update.add_argument("--host", help="命名主机，默认 default_host")
    update.add_argument("--yes", action="store_true", help="确认执行生产更新")
    update.add_argument("--dry-run", action="store_true", help="只打印 SSH 命令，不执行")
    update.add_argument("--follow-update-host", action="store_true", help="从无更新能力的主入口跳到 update_host")

    run = subparsers.add_parser("run", help="在命名主机上执行一条远程命令")
    run.add_argument("--host", help="命名主机，默认 default_host")
    run.add_argument("remote_command", nargs=argparse.REMAINDER, help="远程命令，建议写在 -- 后面")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        catalog = load_catalog(args.hosts_file, args.local_hosts_file)
        if args.command == "list":
            return cmd_list(catalog)
        if args.command == "recipe":
            return cmd_recipe(catalog)
        if args.command == "package":
            return cmd_package(args.tag)
        host = resolve_host(catalog, getattr(args, "host", None))
        if args.command == "show":
            return cmd_show(host)
        if args.command == "check":
            return cmd_check(host)
        if args.command == "status":
            return cmd_status(host)
        if args.command == "update":
            return cmd_update(
                catalog,
                host,
                yes=args.yes,
                dry_run=args.dry_run,
                follow=args.follow_update_host,
            )
        remote_parts = list(args.remote_command)
        if remote_parts and remote_parts[0] == "--":
            remote_parts = remote_parts[1:]
        return cmd_run(host, remote_parts)
    except DeployHostError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
