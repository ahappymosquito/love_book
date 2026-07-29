"""Regression coverage for stable-latest image promotion and production updates."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UPDATE_SCRIPT = PROJECT_ROOT / "scripts" / "update_production.sh"
RELEASE_WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "docker-build.yml"
MANUAL_PROMOTION_WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "promote-latest.yml"
BOOTSTRAP_SCRIPT = PROJECT_ROOT / "deploy_server.sh"


def bash_executable() -> str | None:
    candidates = [r"C:\Program Files\Git\bin\bash.exe", shutil.which("bash")]
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)


def write_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8", newline="\n")
    path.chmod(0o755)


@pytest.fixture
def update_harness(tmp_path: Path) -> dict[str, Path | str]:
    bash = bash_executable()
    if bash is None:
        pytest.skip("bash is required for production update script tests")

    deploy_dir = tmp_path / "deploy"
    fake_bin = tmp_path / "bin"
    deploy_dir.mkdir()
    fake_bin.mkdir()
    (deploy_dir / "docker-compose.yml").write_text(
        """
name: love-book
services:
  backend:
    image: ghcr.io/ahappymosquito/love_book-backend:0.6.0
  frontend:
    image: ghcr.io/ahappymosquito/love_book-frontend:0.6.0
  caddy:
    image: caddy:2-alpine
""".lstrip(),
        encoding="utf-8",
        newline="\n",
    )

    write_executable(
        fake_bin / "docker",
        """#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "${FAKE_LOG}"
case "${1:-}" in
  info) exit 0 ;;
  pull)
    [[ "${FAKE_PULL_FAIL:-0}" != "1" ]]
    exit
    ;;
  image)
    [[ "${2:-}" == "inspect" ]] || exit 2
    image="${@: -1}"
    if [[ "${image}" == *"-backend:"* ]]; then
      printf '%s\n' "${FAKE_BACKEND_VERSION}"
    else
      printf '%s\n' "${FAKE_FRONTEND_VERSION}"
    fi
    ;;
  compose)
    shift
    case "${1:-}" in
      version) exit 0 ;;
      up)
        [[ "${FAKE_UP_FAIL:-0}" != "1" ]]
        touch "${FAKE_UP_MARKER}"
        ;;
      ps|images|logs) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 2 ;;
esac
""",
    )
    write_executable(
        fake_bin / "curl",
        """#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "${FAKE_LOG}"
url="${@: -1}"
if [[ "${url}" == */api/health ]]; then
  if [[ -f "${FAKE_UP_MARKER}" ]]; then
    version="${FAKE_BACKEND_VERSION}"
  else
    version="${FAKE_CURRENT_VERSION}"
  fi
  printf '{"status":"ok","version":"%s","git_sha":"fake"}\n' "${version}"
  exit 0
fi
exit 0
""",
    )
    write_executable(
        fake_bin / "flock",
        """#!/usr/bin/env bash
exit 0
""",
    )
    backup = fake_bin / "love-book-backup"
    write_executable(
        backup,
        """#!/usr/bin/env bash
set -euo pipefail
printf 'backup %s\n' "$*" >> "${FAKE_LOG}"
[[ "${FAKE_BACKUP_FAIL:-0}" != "1" ]]
""",
    )

    return {
        "bash": bash,
        "deploy_dir": deploy_dir,
        "fake_bin": fake_bin,
        "backup": backup,
        "log": tmp_path / "commands.log",
        "up_marker": tmp_path / "up.marker",
    }


def run_update(
    harness: dict[str, Path | str],
    *,
    current: str = "0.6.0",
    backend: str = "0.7.0",
    frontend: str = "0.7.0",
    **overrides: str,
) -> subprocess.CompletedProcess[str]:
    fake_bin = Path(harness["fake_bin"])
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{env['PATH']}",
            "PROJECT_DIR": str(harness["deploy_dir"]),
            "BACKUP_COMMAND": str(harness["backup"]),
            "CURL_COMMAND": str(fake_bin / "curl"),
            "APP_WEB_URL": "https://qrqto.club",
            "HEALTH_ATTEMPTS": "2",
            "HEALTH_DELAY_SECONDS": "0",
            "FAKE_LOG": str(harness["log"]),
            "FAKE_UP_MARKER": str(harness["up_marker"]),
            "FAKE_CURRENT_VERSION": current,
            "FAKE_BACKEND_VERSION": backend,
            "FAKE_FRONTEND_VERSION": frontend,
        }
    )
    env.update(overrides)
    return subprocess.run(
        [str(harness["bash"]), str(UPDATE_SCRIPT)],
        cwd=PROJECT_ROOT,
        env=env,
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
    )


def command_log(harness: dict[str, Path | str]) -> str:
    path = Path(harness["log"])
    return path.read_text(encoding="utf-8") if path.exists() else ""


def test_update_skips_backup_and_restart_when_latest_is_running(update_harness: dict[str, Path | str]) -> None:
    result = run_update(update_harness, current="0.7.0")

    assert result.returncode == 0, result.stderr
    log = command_log(update_harness)
    assert "backup pre-release" not in log
    assert "compose up" not in log


def test_update_backs_up_and_starts_matching_latest_images(update_harness: dict[str, Path | str]) -> None:
    result = run_update(update_harness)

    assert result.returncode == 0, result.stderr
    log = command_log(update_harness)
    assert "backup pre-release" in log
    assert "compose up -d --remove-orphans" in log
    override = Path(update_harness["deploy_dir"]) / "docker-compose.override.yml"
    contents = override.read_text(encoding="utf-8")
    assert "love_book-backend:latest" in contents
    assert "love_book-frontend:latest" in contents
    assert "0.6.0" not in contents


def test_update_rejects_mismatched_frontend_and_backend_versions(
    update_harness: dict[str, Path | str],
) -> None:
    result = run_update(update_harness, frontend="0.8.0")

    assert result.returncode != 0
    log = command_log(update_harness)
    assert "backup pre-release" not in log
    assert "compose up" not in log


@pytest.mark.parametrize(
    ("failure_env", "expected_absent"),
    [
        ({"FAKE_PULL_FAIL": "1"}, "backup pre-release"),
        ({"FAKE_BACKUP_FAIL": "1"}, "compose up"),
        ({"FAKE_UP_FAIL": "1"}, "PUBLIC_HEALTH_OK"),
    ],
)
def test_update_does_not_report_success_after_operational_failure(
    update_harness: dict[str, Path | str],
    failure_env: dict[str, str],
    expected_absent: str,
) -> None:
    result = run_update(update_harness, **failure_env)

    assert result.returncode != 0
    assert "Update completed" not in result.stdout
    assert expected_absent not in command_log(update_harness)


def test_release_workflow_promotes_latest_only_after_both_images() -> None:
    workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

    assert "promote-latest:" in workflow
    assert "needs: [prep, backend, frontend]" in workflow
    assert "imagetools create" in workflow
    assert "-backend:latest" in workflow
    assert "-frontend:latest" in workflow
    assert "needs: [prep, promote-latest]" in workflow


def test_existing_release_can_be_promoted_without_rebuilding() -> None:
    workflow = MANUAL_PROMOTION_WORKFLOW.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert "gh release view" in workflow
    assert "imagetools create" in workflow
    assert "docker/build-push-action" not in workflow


def test_server_bootstrap_defaults_to_stable_latest() -> None:
    script = BOOTSTRAP_SCRIPT.read_text(encoding="utf-8")

    assert 'local image_tag="latest"' in script
    assert 'if [[ -n "${LOVE_BOOK_VERSION}" ]]' in script
    assert "LOVE_BOOK_VERSION must be X.Y.Z when provided" in script
