"""从 LOVE_BOOK_SSH_HOSTS 读取 ~/.ssh/config 主机名，供智能体完成打包到发布。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"
DEFAULT_EXAMPLE_FILE = PROJECT_ROOT / ".env.example"
VERSION_SCRIPT = PROJECT_ROOT / "scripts" / "version.py"
ENV_PREFIX = "LOVE_BOOK_SSH_"

NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
DEFAULT_COMPOSE_DIR = "/home/ts3/love-book"
DEFAULT_HEALTH_URL = "https://qrqto.club/api/health"
DEFAULT_SITE_URL = "https://qrqto.club/"
DEFAULT_BACKUP_ROOT = "/home/ts3/backups/love_book"
DEFAULT_BACKUP_COMMAND = "/home/ts3/bin/love-book-backup"
DEFAULT_UPDATE_COMMAND = "bash /home/ts3/love-book/update.sh"
DEFAULT_BACKEND_IMAGE = "ghcr.io/ahappymosquito/love_book-backend:latest"
DEFAULT_FRONTEND_IMAGE = "ghcr.io/ahappymosquito/love_book-frontend:latest"
DEFAULT_CONNECT_TIMEOUT = 20
REQUIRED_PACKAGE_FILES = (
    "Dockerfile",
    "web/Dockerfile",
    "docker-compose.yml",
    "deploy/caddy/Caddyfile",
    ".env.example",
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
    """一份由 SSH 主机名展开后的发布目标。"""

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
    """命名主机表，第一项为默认检查入口。"""

    default_host: str
    hosts: dict[str, DeployHost]
    source: Path


def posix_quote(value: str) -> str:
    """按 POSIX 单引号规则引用远程命令参数，避免 Windows shlex.quote 改用双引号。"""
    return "'" + value.replace("'", "'\"'\"'") + "'"


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def mapping_get(env: Mapping[str, str], key: str) -> str:
    value = env.get(key, "")
    if value is None:
        return ""
    return str(value).strip()


def parse_env_file(path: Path) -> dict[str, str]:
    """读取 KEY=VALUE 行。不执行 shell，也不把密钥打到日志。"""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        values[key] = value.strip().strip("'").strip('"')
    return values


def collect_ssh_env(
    env_file: Path | None = None,
    example_file: Path | None = None,
    *,
    include_process: bool | None = None,
) -> tuple[dict[str, str], Path]:
    """合并顺序：.env.example → .env → 进程里已有的 LOVE_BOOK_SSH_*。"""
    using_defaults = env_file is None and example_file is None
    example = example_file if example_file is not None else DEFAULT_EXAMPLE_FILE
    local = env_file if env_file is not None else DEFAULT_ENV_FILE
    merged: dict[str, str] = {}
    source = example
    if example.is_file():
        merged.update(parse_env_file(example))
        source = example
    if local.is_file():
        merged.update(parse_env_file(local))
        source = local
    if include_process is None:
        include_process = using_defaults
    if include_process:
        for key, value in os.environ.items():
            if key.startswith(ENV_PREFIX):
                merged[key] = value
    return merged, source


def host_names_from_env(env: Mapping[str, str]) -> list[str]:
    names = split_csv(mapping_get(env, f"{ENV_PREFIX}HOSTS"))
    if not names:
        names = split_csv(mapping_get(env, f"{ENV_PREFIX}HOST"))
    return names


def _require_name(value: str) -> str:
    if not NAME_PATTERN.fullmatch(value):
        raise DeployHostError(f"SSH host must be a SSH-safe identifier, got {value!r}")
    return value


def heuristic_user(alias: str) -> str:
    """约定 Host 名为 user_site，例如 ts3_qrqto、root_qrqto。"""
    if "_" in alias:
        return alias.split("_", 1)[0]
    return alias


def inspect_ssh_identity(alias: str) -> tuple[str, bool]:
    """返回 (user, configured)。configured 表示 ~/.ssh/config 里有独立 HostName。"""
    ssh = shutil.which("ssh")
    if not ssh:
        return heuristic_user(alias), False
    try:
        result = subprocess.run(
            [ssh, "-G", alias],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return heuristic_user(alias), False
    if result.returncode != 0:
        return heuristic_user(alias), False
    user = ""
    hostname = alias
    for line in result.stdout.splitlines():
        if line.startswith("user "):
            user = line.split(None, 1)[1].strip()
        elif line.startswith("hostname "):
            hostname = line.split(None, 1)[1].strip()
    configured = bool(hostname) and hostname != alias
    if configured and user:
        return user, True
    return heuristic_user(alias), configured


def resolve_ssh_user(alias: str, ssh_users: Mapping[str, str] | None = None) -> str:
    if ssh_users is not None:
        if alias in ssh_users:
            return ssh_users[alias]
        return heuristic_user(alias)
    user, _configured = inspect_ssh_identity(alias)
    return user


def is_update_user(user: str) -> bool:
    return user == "root"


def build_host(name: str, update_host: str, user: str) -> DeployHost:
    updater = is_update_user(user)
    backup_command = DEFAULT_BACKUP_COMMAND
    if updater:
        backup_command = f"runuser -u ts3 -- env HOME=/home/ts3 {DEFAULT_BACKUP_COMMAND}"
    if updater:
        capabilities = ("check", "status", "update", "backup", "run")
        notes = "User=root，用于跑已安装的 update.sh。未经当次明确授权不要 --yes。"
        label = "生产管理员账号"
        role = "production-admin"
        update_style = "updater"
        linked = ""
    else:
        capabilities = ("check", "status", "backup", "run")
        notes = "日常检查入口。发布请用 User=root 的 SSH 主机。"
        label = "生产应用账号"
        role = "production-app"
        update_style = "none"
        linked = update_host if update_host != name else ""
    return DeployHost(
        name=name,
        ssh_alias=name,
        user=user,
        role=role,
        label=label,
        compose_dir=DEFAULT_COMPOSE_DIR,
        health_url=DEFAULT_HEALTH_URL,
        site_url=DEFAULT_SITE_URL,
        update_style=update_style,
        update_command=DEFAULT_UPDATE_COMMAND if updater else "",
        update_host=linked,
        backup_command=backup_command,
        backup_root=DEFAULT_BACKUP_ROOT,
        backend_image=DEFAULT_BACKEND_IMAGE,
        frontend_image=DEFAULT_FRONTEND_IMAGE,
        connect_timeout=DEFAULT_CONNECT_TIMEOUT,
        capabilities=capabilities,
        notes=notes,
    )


def load_catalog(
    env_file: Path | None = None,
    example_file: Path | None = None,
    environ: Mapping[str, str] | None = None,
    ssh_users: Mapping[str, str] | None = None,
) -> HostCatalog:
    if environ is None:
        env, source = collect_ssh_env(env_file, example_file)
    else:
        env = dict(environ)
        source = env_file or example_file or DEFAULT_EXAMPLE_FILE
    names = [_require_name(name) for name in host_names_from_env(env)]
    if not names:
        raise DeployHostError(
            "LOVE_BOOK_SSH_HOSTS is missing. Set SSH Host names, for example: "
            "LOVE_BOOK_SSH_HOSTS=ts3_qrqto,root_qrqto"
        )
    users = {name: resolve_ssh_user(name, ssh_users) for name in names}
    update_host = next((name for name in names if is_update_user(users[name])), "")
    hosts = {name: build_host(name, update_host, users[name]) for name in names}
    return HostCatalog(default_host=names[0], hosts=hosts, source=source)


def catalog_update_host(catalog: HostCatalog) -> str:
    for host in catalog.hosts.values():
        if "update" in host.capabilities:
            return host.name
    return catalog.default_host


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


def cmd_package(tag: str | None, catalog: HostCatalog) -> int:
    print("===== 打包前检查 =====")
    version_output = run_version_check(tag)
    print(version_output)
    missing = [rel for rel in REQUIRED_PACKAGE_FILES if not (PROJECT_ROOT / rel).is_file()]
    if missing:
        raise DeployHostError("Missing required packaging files:\n- " + "\n- ".join(missing))
    print("required_files=ok")
    version = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()
    print(f"package_version={version}")
    update_host = catalog_update_host(catalog)
    print("下一步（推送标签和发布镜像需要当次明确授权）：")
    print(f"  git tag -a v{version} -m \"Love Book {version}\"")
    print(f"  git push origin v{version}")
    print("  等待 GitHub Actions release-images 成功")
    print(f"  python scripts/deploy_host.py check --host {catalog.default_host}")
    print(f"  python scripts/deploy_host.py update --host {update_host} --yes")
    return 0


def cmd_recipe(catalog: HostCatalog) -> int:
    update_host = catalog_update_host(catalog)
    print(
        f"""Love Book 智能体打包到发布

只配置 LOVE_BOOK_SSH_HOSTS（~/.ssh/config 的 Host 名）。第一项是检查入口，User=root 的项用来发布。

1. 只有正式发布才改 VERSION / CHANGELOG，并运行 python scripts/version.py sync
2. python scripts/deploy_host.py package --tag vX.Y.Z
3. 运行后端测试和前端生产构建
4. 经用户明确授权后创建并推送 annotated tag vX.Y.Z
5. 等待 GitHub Actions 构建同版本前后端镜像并提升 latest
6. python scripts/deploy_host.py check --host {catalog.default_host}
7. python scripts/deploy_host.py status --host {catalog.default_host}
8. python scripts/deploy_host.py update --host {update_host} --yes
9. curl -fsS https://qrqto.club/api/health  确认 version 与 VERSION 一致

当前主机来自 {catalog.source}。加主机只需把名字写进 LOVE_BOOK_SSH_HOSTS。
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
    parser.add_argument("--env-file", type=Path, help="覆盖本机 .env")
    parser.add_argument("--example-file", type=Path, help="覆盖 .env.example")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="列出已配置的命名 SSH 主机")
    subparsers.add_parser("recipe", help="打印智能体打包到发布步骤")

    show = subparsers.add_parser("show", help="显示一个命名主机的完整参数")
    show.add_argument("--host", help="命名主机，默认 LOVE_BOOK_SSH_HOSTS 第一项")

    check = subparsers.add_parser("check", help="BatchMode SSH 探测目录、Docker 和更新器")
    check.add_argument("--host", help="命名主机，默认 LOVE_BOOK_SSH_HOSTS 第一项")

    status = subparsers.add_parser("status", help="查看远程 Compose 状态和健康检查")
    status.add_argument("--host", help="命名主机，默认 LOVE_BOOK_SSH_HOSTS 第一项")

    package = subparsers.add_parser("package", help="本地打包前检查版本和必要文件")
    package.add_argument("--tag", help="正式发布标签，例如 v0.9.0")

    update = subparsers.add_parser("update", help="通过 User=root 的主机执行生产更新器")
    update.add_argument("--host", help="命名主机，默认 LOVE_BOOK_SSH_HOSTS 第一项")
    update.add_argument("--yes", action="store_true", help="确认执行生产更新")
    update.add_argument("--dry-run", action="store_true", help="只打印 SSH 命令，不执行")
    update.add_argument("--follow-update-host", action="store_true", help="从检查入口跳到 User=root 的主机")

    run = subparsers.add_parser("run", help="在命名主机上执行一条远程命令")
    run.add_argument("--host", help="命名主机，默认 LOVE_BOOK_SSH_HOSTS 第一项")
    run.add_argument("remote_command", nargs=argparse.REMAINDER, help="远程命令，建议写在 -- 后面")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        catalog = load_catalog(args.env_file, args.example_file)
        if args.command == "list":
            return cmd_list(catalog)
        if args.command == "recipe":
            return cmd_recipe(catalog)
        if args.command == "package":
            return cmd_package(args.tag, catalog)
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
