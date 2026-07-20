"""Read the single Love Book application version and runtime build revision."""

from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = PROJECT_ROOT / "VERSION"


def read_app_version() -> str:
    """Return the repository-controlled application version."""
    return VERSION_FILE.read_text(encoding="utf-8").strip()


APP_VERSION = read_app_version()
APP_GIT_SHA = os.getenv("APP_GIT_SHA", "development").strip() or "development"
