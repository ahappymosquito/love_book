"""命名 SSH 主机 env 配置与打包发布 CLI 的回归测试。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.deploy_host import (
    DEFAULT_EXAMPLE_FILE,
    DeployHostError,
    build_ssh_argv,
    load_catalog,
    posix_quote,
    resolve_host,
    resolve_update_host,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


MINIMAL_ENV = {
    "LOVE_BOOK_SSH_HOSTS": "ts3_qrqto,root_qrqto",
    "LOVE_BOOK_SSH_DEFAULT_HOST": "ts3_qrqto",
    "LOVE_BOOK_SSH_UPDATE_HOST": "root_qrqto",
    "LOVE_BOOK_SSH_COMPOSE_DIR": "/home/ts3/love-book",
    "LOVE_BOOK_SSH_HEALTH_URL": "https://qrqto.club/api/health",
    "LOVE_BOOK_SSH_SITE_URL": "https://qrqto.club/",
    "LOVE_BOOK_SSH_BACKUP_COMMAND": "/home/ts3/bin/love-book-backup",
    "LOVE_BOOK_SSH_BACKUP_ROOT": "/home/ts3/backups/love_book",
    "LOVE_BOOK_SSH_UPDATE_COMMAND": "bash /home/ts3/love-book/update.sh",
    "LOVE_BOOK_SSH_TS3_QRQTO_USER": "ts3",
    "LOVE_BOOK_SSH_TS3_QRQTO_ROLE": "production-app",
    "LOVE_BOOK_SSH_TS3_QRQTO_LABEL": "生产应用账号",
    "LOVE_BOOK_SSH_TS3_QRQTO_CAPABILITIES": "check,status,backup,run",
    "LOVE_BOOK_SSH_TS3_QRQTO_UPDATE_STYLE": "none",
    "LOVE_BOOK_SSH_TS3_QRQTO_UPDATE_HOST": "root_qrqto",
    "LOVE_BOOK_SSH_ROOT_QRQTO_USER": "root",
    "LOVE_BOOK_SSH_ROOT_QRQTO_ROLE": "production-admin",
    "LOVE_BOOK_SSH_ROOT_QRQTO_LABEL": "生产管理员账号",
    "LOVE_BOOK_SSH_ROOT_QRQTO_CAPABILITIES": "check,status,update,backup,run",
    "LOVE_BOOK_SSH_ROOT_QRQTO_UPDATE_STYLE": "updater",
}


def write_env(path: Path, values: dict[str, str]) -> Path:
    path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="utf-8")
    return path


def test_env_example_defines_ts3_and_root() -> None:
    catalog = load_catalog(example_file=DEFAULT_EXAMPLE_FILE, env_file=Path("does-not-exist.env"))

    assert catalog.default_host == "ts3_qrqto"
    assert set(catalog.hosts) >= {"ts3_qrqto", "root_qrqto"}
    ts3 = catalog.hosts["ts3_qrqto"]
    root = catalog.hosts["root_qrqto"]
    assert ts3.ssh_alias == "ts3_qrqto"
    assert ts3.user == "ts3"
    assert ts3.update_host == "root_qrqto"
    assert "update" not in ts3.capabilities
    assert root.ssh_alias == "root_qrqto"
    assert root.user == "root"
    assert root.update_style == "updater"
    assert "update" in root.capabilities
    assert root.update_command == "bash /home/ts3/love-book/update.sh"


def test_posix_quote_wraps_spaces_and_embedded_quotes() -> None:
    assert posix_quote("ts3") == "'ts3'"
    assert posix_quote("love book") == "'love book'"
    assert posix_quote("it's") == "'it'\"'\"'s'"


def test_load_catalog_merges_local_env_and_extra_host(tmp_path: Path) -> None:
    example = write_env(tmp_path / ".env.example", MINIMAL_ENV)
    local = write_env(
        tmp_path / ".env",
        {
            "LOVE_BOOK_SSH_HOSTS": "ts3_qrqto,root_qrqto,lab_qrqto",
            "LOVE_BOOK_SSH_DEFAULT_HOST": "lab_qrqto",
            "LOVE_BOOK_SSH_TS3_QRQTO_CONNECT_TIMEOUT": "9",
            "LOVE_BOOK_SSH_LAB_QRQTO_USER": "ts3",
            "LOVE_BOOK_SSH_LAB_QRQTO_ALIAS": "lab_qrqto",
            "LOVE_BOOK_SSH_LAB_QRQTO_COMPOSE_DIR": "/home/ts3/love-book-lab",
            "LOVE_BOOK_SSH_LAB_QRQTO_HEALTH_URL": "https://lab.qrqto.club/api/health",
            "LOVE_BOOK_SSH_LAB_QRQTO_SITE_URL": "https://lab.qrqto.club/",
            "LOVE_BOOK_SSH_LAB_QRQTO_UPDATE_STYLE": "none",
            "LOVE_BOOK_SSH_LAB_QRQTO_CAPABILITIES": "check,status",
        },
    )

    catalog = load_catalog(env_file=local, example_file=example)

    assert catalog.default_host == "lab_qrqto"
    assert catalog.hosts["ts3_qrqto"].connect_timeout == 9
    assert catalog.hosts["lab_qrqto"].ssh_alias == "lab_qrqto"
    assert "root_qrqto" in catalog.hosts


def test_unknown_host_lists_configured_names() -> None:
    catalog = load_catalog(environ=MINIMAL_ENV)

    with pytest.raises(DeployHostError, match="Unknown SSH host 'nope'"):
        resolve_host(catalog, "nope")


def test_invalid_host_name_is_rejected() -> None:
    with pytest.raises(DeployHostError, match="SSH-safe identifier"):
        load_catalog(environ={"LOVE_BOOK_SSH_HOSTS": "bad host", "LOVE_BOOK_SSH_BAD_HOST_USER": "ts3"})


def test_update_on_ts3_requires_follow_or_root() -> None:
    catalog = load_catalog(environ=MINIMAL_ENV)
    ts3 = catalog.hosts["ts3_qrqto"]

    with pytest.raises(DeployHostError, match="--follow-update-host"):
        resolve_update_host(catalog, ts3, follow=False)

    followed = resolve_update_host(catalog, ts3, follow=True)
    assert followed.name == "root_qrqto"
    assert followed.update_command.endswith("update.sh")


def test_build_ssh_argv_uses_batchmode_and_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV)
    monkeypatch.setattr("scripts.deploy_host.shutil.which", lambda name: r"C:\Windows\System32\OpenSSH\ssh.exe")

    argv = build_ssh_argv(catalog.hosts["ts3_qrqto"], "whoami")

    assert argv[0].endswith("ssh.exe")
    assert argv[1:5] == ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]
    assert "ts3_qrqto" in argv
    assert argv[-1] == "whoami"


def run_cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    if env:
        command_env.update(env)
    return subprocess.run(
        [sys.executable, "scripts/deploy_host.py", *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
        env=command_env,
    )


def test_cli_list_and_show_use_env_example() -> None:
    listed = run_cli("list")
    assert listed.returncode == 0, listed.stderr
    assert "ts3_qrqto" in listed.stdout
    assert "root_qrqto" in listed.stdout
    assert "default_host=ts3_qrqto" in listed.stdout

    shown = run_cli("show", "--host", "root_qrqto")
    assert shown.returncode == 0, shown.stderr
    payload = json.loads(shown.stdout)
    assert payload["ssh_alias"] == "root_qrqto"
    assert payload["update_style"] == "updater"


def test_cli_update_without_yes_is_refused(tmp_path: Path) -> None:
    env_file = write_env(tmp_path / ".env", MINIMAL_ENV)
    example = write_env(tmp_path / "empty.env", {})
    result = run_cli(
        "--env-file",
        str(env_file),
        "--example-file",
        str(example),
        "update",
        "--host",
        "root_qrqto",
    )

    assert result.returncode == 1
    assert "without --yes" in result.stderr


def test_cli_update_dry_run_from_ts3_with_follow(tmp_path: Path) -> None:
    env_file = write_env(tmp_path / ".env", MINIMAL_ENV)
    example = write_env(tmp_path / "empty.env", {})
    result = run_cli(
        "--env-file",
        str(env_file),
        "--example-file",
        str(example),
        "update",
        "--host",
        "ts3_qrqto",
        "--follow-update-host",
        "--dry-run",
    )

    assert result.returncode == 0, result.stderr
    assert "update_host_follow ts3_qrqto -> root_qrqto" in result.stdout
    assert "bash /home/ts3/love-book/update.sh" in result.stdout
    assert "dry_run=true" in result.stdout


def test_cli_package_checks_canonical_version() -> None:
    result = run_cli("package")

    assert result.returncode == 0, result.stderr
    assert "required_files=ok" in result.stdout
    assert "package_version=" in result.stdout
    assert "python scripts/deploy_host.py update --host root_qrqto --yes" in result.stdout


def test_cli_recipe_mentions_env_and_multiple_hosts() -> None:
    result = run_cli("recipe")

    assert result.returncode == 0, result.stderr
    assert "ts3_qrqto" in result.stdout
    assert "root_qrqto" in result.stdout
    assert ".env.example" in result.stdout
    assert "LOVE_BOOK_SSH_" in result.stdout
