"""Regression tests for canonical version synchronization and runtime build identity."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_VERSION = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()


def run_version_command(command: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "scripts/version.py", command, *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        check=False,
        text=True,
    )


def test_version_manifests_match_canonical_version() -> None:
    result = run_version_command("check")

    assert result.returncode == 0, result.stderr
    assert f"Love Book version {APP_VERSION} is consistent" in result.stdout


def test_release_tag_must_match_canonical_version() -> None:
    result = run_version_command("check", "--tag", "v999.999.999")

    assert result.returncode == 1
    assert f"must equal 'v{APP_VERSION}'" in result.stderr


def test_release_notes_come_from_the_matching_changelog_section() -> None:
    result = run_version_command("notes", "--tag", f"v{APP_VERSION}")

    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith(f"# Love Book {APP_VERSION} (")
    assert "### Added" in result.stdout
    assert "## [Unreleased]" not in result.stdout
