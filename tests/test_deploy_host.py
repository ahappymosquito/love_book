"""命名 SSH 主机 env 配置、VERSION 固定镜像标签、更新后版本核对与 run 授权门禁的回归测试。"""

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
    cmd_run,
    cmd_update,
    heuristic_user,
    load_catalog,
    parse_health_version,
    posix_quote,
    read_app_version,
    resolve_host,
    resolve_update_host,
    update_remote_command,
    verify_health_version,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()
MINIMAL_ENV = {"LOVE_BOOK_SSH_HOSTS": "cn-ts3,cn"}
SSH_USERS = {"cn-ts3": "ts3", "cn": "root", "lab_tingle": "ts3"}
HEURISTIC_ENV = {"LOVE_BOOK_SSH_HOSTS": "ts3_tingle,root_tingle"}


def write_env(path: Path, values: dict[str, str]) -> Path:
    path.write_text("\n".join(f"{key}={value}" for key, value in values.items()) + "\n", encoding="utf-8")
    return path


def test_env_example_only_needs_host_names() -> None:
    catalog = load_catalog(
        example_file=DEFAULT_EXAMPLE_FILE,
        env_file=Path("does-not-exist.env"),
        ssh_users=SSH_USERS,
    )

    assert catalog.default_host == "cn-ts3"
    assert set(catalog.hosts) == {"cn-ts3", "cn"}
    ts3 = catalog.hosts["cn-ts3"]
    root = catalog.hosts["cn"]
    assert ts3.user == "ts3"
    assert ts3.update_host == "cn"
    assert "update" not in ts3.capabilities
    assert root.user == "root"
    assert root.update_style == "updater"
    assert "update" in root.capabilities
    assert root.update_command == "bash /home/ts3/love-book/update.sh"


def test_posix_quote_wraps_spaces_and_embedded_quotes() -> None:
    assert posix_quote("ts3") == "'ts3'"
    assert posix_quote("love book") == "'love book'"
    assert posix_quote("it's") == "'it'\"'\"'s'"


def test_load_catalog_adds_extra_ssh_name(tmp_path: Path) -> None:
    example = write_env(tmp_path / ".env.example", MINIMAL_ENV)
    local = write_env(tmp_path / ".env", {"LOVE_BOOK_SSH_HOSTS": "lab_tingle,cn-ts3,cn"})

    catalog = load_catalog(env_file=local, example_file=example, ssh_users=SSH_USERS)

    assert catalog.default_host == "lab_tingle"
    assert catalog.hosts["lab_tingle"].user == "ts3"
    assert "update" not in catalog.hosts["lab_tingle"].capabilities
    assert catalog.hosts["cn"].update_style == "updater"


def test_unknown_host_lists_configured_names() -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)

    with pytest.raises(DeployHostError, match="Unknown SSH host 'nope'"):
        resolve_host(catalog, "nope")


def test_invalid_host_name_is_rejected() -> None:
    with pytest.raises(DeployHostError, match="SSH-safe identifier"):
        load_catalog(environ={"LOVE_BOOK_SSH_HOSTS": "bad host"}, ssh_users={})


def test_update_on_ts3_requires_follow_or_root() -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)
    ts3 = catalog.hosts["cn-ts3"]

    with pytest.raises(DeployHostError, match="--follow-update-host"):
        resolve_update_host(catalog, ts3, follow=False)

    followed = resolve_update_host(catalog, ts3, follow=True)
    assert followed.name == "cn"
    assert followed.update_command.endswith("update.sh")


def test_build_ssh_argv_uses_batchmode_and_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)
    monkeypatch.setattr("scripts.deploy_host.shutil.which", lambda name: r"C:\Windows\System32\OpenSSH\ssh.exe")

    argv = build_ssh_argv(catalog.hosts["cn-ts3"], "whoami")

    assert argv[0].endswith("ssh.exe")
    assert argv[1:5] == ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]
    assert "cn-ts3" in argv
    assert argv[-1] == "whoami"


def test_heuristic_user_from_host_name_without_ssh_config() -> None:
    catalog = load_catalog(environ=HEURISTIC_ENV, ssh_users={})

    assert catalog.hosts["ts3_tingle"].user == "ts3"
    assert catalog.hosts["root_tingle"].user == "root"
    assert catalog.hosts["root_tingle"].update_style == "updater"


def test_documented_hosts_without_ssh_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "scripts.deploy_host.inspect_ssh_identity",
        lambda alias: (heuristic_user(alias), False),
    )

    catalog = load_catalog(
        example_file=DEFAULT_EXAMPLE_FILE,
        env_file=Path("does-not-exist.env"),
    )

    assert catalog.hosts["cn-ts3"].user == "ts3"
    assert catalog.hosts["cn-ts3"].update_host == "cn"
    assert "update" not in catalog.hosts["cn-ts3"].capabilities
    assert catalog.hosts["cn"].user == "root"
    assert catalog.hosts["cn"].update_style == "updater"


def run_cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    command_env.setdefault("PYTHONUTF8", "1")
    command_env.setdefault("PYTHONIOENCODING", "utf-8")
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
    assert "cn-ts3" in listed.stdout
    assert "default_host=cn-ts3" in listed.stdout
    assert "cn" in listed.stdout

    shown = run_cli("show", "--host", "cn")
    assert shown.returncode == 0, shown.stderr
    payload = json.loads(shown.stdout)
    assert payload["ssh_alias"] == "cn"
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
        "cn",
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
        "cn-ts3",
        "--follow-update-host",
        "--dry-run",
    )

    assert result.returncode == 0, result.stderr
    assert "update_host_follow cn-ts3 -> cn" in result.stdout
    assert "bash /home/ts3/love-book/update.sh" in result.stdout
    assert f"remote=LOVE_BOOK_IMAGE_TAG='{APP_VERSION}' bash /home/ts3/love-book/update.sh" in result.stdout
    assert "dry_run=true" in result.stdout


def test_images_are_pinned_to_version_not_latest() -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)

    for host in catalog.hosts.values():
        assert host.image_tag == APP_VERSION
        assert host.backend_image == f"ghcr.io/ahappymosquito/love_book-backend:{APP_VERSION}"
        assert host.frontend_image == f"ghcr.io/ahappymosquito/love_book-frontend:{APP_VERSION}"
        assert not host.backend_image.endswith(":latest")
        assert not host.frontend_image.endswith(":latest")
    assert update_remote_command(catalog.hosts["cn"]) == (
        f"LOVE_BOOK_IMAGE_TAG='{APP_VERSION}' bash /home/ts3/love-book/update.sh"
    )


def test_read_app_version_rejects_non_semver(tmp_path: Path) -> None:
    bad = tmp_path / "VERSION"
    bad.write_text("v1.2\n", encoding="utf-8")

    with pytest.raises(DeployHostError, match="stable SemVer"):
        read_app_version(bad)


def test_parse_health_version_reads_json_payload() -> None:
    assert parse_health_version('{"status":"ok","version":"1.2.3","git_sha":"abc"}') == "1.2.3"
    assert parse_health_version("") == ""
    assert parse_health_version("not json") == ""
    assert parse_health_version('["1.2.3"]') == ""


def test_verify_health_version_retries_until_match() -> None:
    bodies = iter(["", '{"version":"1.2.2"}', '{"version":"1.2.3"}'])
    sleeps: list[float] = []

    body = verify_health_version(
        "https://example.invalid/health",
        "1.2.3",
        attempts=3,
        delay=0.5,
        fetch=lambda _url: next(bodies),
        sleep=sleeps.append,
    )

    assert '"1.2.3"' in body
    assert sleeps == [0.5, 0.5]


def test_verify_health_version_fails_on_mismatch() -> None:
    with pytest.raises(DeployHostError, match="expected 1.2.3, got 1.2.2"):
        verify_health_version(
            "https://example.invalid/health",
            "1.2.3",
            attempts=2,
            delay=0,
            fetch=lambda _url: '{"version":"1.2.2"}',
            sleep=lambda _seconds: None,
        )


def test_update_fails_when_production_version_differs(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)
    calls: list[str] = []

    def fake_run_ssh(host, remote, *, timeout=None):
        calls.append(remote)
        return subprocess.CompletedProcess(["ssh"], 0, stdout="UPDATED\n", stderr="")

    monkeypatch.setattr("scripts.deploy_host.shutil.which", lambda name: "ssh")
    monkeypatch.setattr("scripts.deploy_host.run_ssh", fake_run_ssh)
    monkeypatch.setattr("scripts.deploy_host.fetch_health", lambda url: '{"version":"0.0.1"}')
    monkeypatch.setattr("scripts.deploy_host.time.sleep", lambda seconds: None)

    with pytest.raises(DeployHostError, match="Production version mismatch"):
        cmd_update(catalog, catalog.hosts["cn"], yes=True, dry_run=False, follow=False)
    assert calls == [f"LOVE_BOOK_IMAGE_TAG='{APP_VERSION}' bash /home/ts3/love-book/update.sh"]


def test_update_succeeds_when_production_version_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)
    monkeypatch.setattr("scripts.deploy_host.shutil.which", lambda name: "ssh")
    monkeypatch.setattr(
        "scripts.deploy_host.run_ssh",
        lambda host, remote, *, timeout=None: subprocess.CompletedProcess(["ssh"], 0, stdout="", stderr=""),
    )
    monkeypatch.setattr(
        "scripts.deploy_host.fetch_health",
        lambda url: json.dumps({"status": "ok", "version": APP_VERSION, "git_sha": "abc"}),
    )

    assert cmd_update(catalog, catalog.hosts["cn"], yes=True, dry_run=False, follow=False) == 0


def test_run_on_update_host_requires_yes(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)

    def forbidden_run_ssh(*_args, **_kwargs):
        raise AssertionError("run must not reach SSH without --yes")

    monkeypatch.setattr("scripts.deploy_host.run_ssh", forbidden_run_ssh)

    with pytest.raises(DeployHostError, match="without --yes"):
        cmd_run(catalog.hosts["cn"], ["docker", "ps"])
    assert cmd_run(catalog.hosts["cn"], ["docker", "ps"], dry_run=True) == 0


def test_run_on_check_host_does_not_need_yes(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = load_catalog(environ=MINIMAL_ENV, ssh_users=SSH_USERS)
    calls: list[str] = []

    def fake_run_ssh(host, remote, *, timeout=None):
        calls.append(remote)
        return subprocess.CompletedProcess(["ssh"], 0, stdout="ok\n", stderr="")

    monkeypatch.setattr("scripts.deploy_host.run_ssh", fake_run_ssh)

    assert cmd_run(catalog.hosts["cn-ts3"], ["docker", "ps"]) == 0
    assert calls == ["docker ps"]


def test_cli_run_on_root_host_without_yes_is_refused(tmp_path: Path) -> None:
    env_file = write_env(tmp_path / ".env", MINIMAL_ENV)
    example = write_env(tmp_path / "empty.env", {})
    common = ("--env-file", str(env_file), "--example-file", str(example), "run", "--host", "cn")

    refused = run_cli(*common, "--", "docker", "ps")
    assert refused.returncode == 1
    assert "without --yes" in refused.stderr

    dry = run_cli(*common, "--dry-run", "--", "docker", "ps")
    assert dry.returncode == 0, dry.stderr
    assert "remote=docker ps" in dry.stdout
    assert "dry_run=true" in dry.stdout


def test_cli_package_checks_canonical_version() -> None:
    result = run_cli("package")

    assert result.returncode == 0, result.stderr
    assert "required_files=ok" in result.stdout
    assert f"package_version={APP_VERSION}" in result.stdout
    assert f"backend_image=ghcr.io/ahappymosquito/love_book-backend:{APP_VERSION}" in result.stdout
    assert "python scripts/deploy_host.py update --host cn --yes" in result.stdout
    assert f"LOVE_BOOK_IMAGE_TAG={APP_VERSION}" in result.stdout


def test_cli_recipe_mentions_host_names_only() -> None:
    result = run_cli("recipe")

    assert result.returncode == 0, result.stderr
    assert "cn-ts3" in result.stdout
    assert "LOVE_BOOK_SSH_HOSTS=cn-ts3,cn" in result.stdout or "cn-ts3" in result.stdout
    assert "LOVE_BOOK_SSH_HOSTS" in result.stdout
    assert "LOVE_BOOK_SSH_<NAME>" not in result.stdout
    assert "LOVE_BOOK_IMAGE_TAG" in result.stdout
    assert "并提升 latest" not in result.stdout
