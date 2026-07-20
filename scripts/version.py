"""Synchronize and verify Love Book's single semantic version across project manifests."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = PROJECT_ROOT / "VERSION"
PACKAGE_JSON = PROJECT_ROOT / "web" / "package.json"
PACKAGE_LOCK = PROJECT_ROOT / "web" / "package-lock.json"
CHANGELOG = PROJECT_ROOT / "CHANGELOG.md"
SEMVER_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class VersionError(RuntimeError):
    """Raised when application versions are missing, malformed, or inconsistent."""


def read_version() -> str:
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not SEMVER_PATTERN.fullmatch(version):
        raise VersionError(f"VERSION must contain stable SemVer X.Y.Z, got: {version!r}")
    return version


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sync_manifests(version: str) -> None:
    package = read_json(PACKAGE_JSON)
    package["version"] = version
    write_json(PACKAGE_JSON, package)

    lock = read_json(PACKAGE_LOCK)
    lock["version"] = version
    root_package = lock.get("packages", {}).get("")
    if not isinstance(root_package, dict):
        raise VersionError("web/package-lock.json is missing packages['']")
    root_package["version"] = version
    write_json(PACKAGE_LOCK, lock)


def check_manifests(version: str, tag: str | None = None) -> None:
    errors: list[str] = []
    package = read_json(PACKAGE_JSON)
    lock = read_json(PACKAGE_LOCK)
    observed = {
        "web/package.json": package.get("version"),
        "web/package-lock.json": lock.get("version"),
        "web/package-lock.json packages['']": lock.get("packages", {}).get("", {}).get("version"),
    }
    for source, value in observed.items():
        if value != version:
            errors.append(f"{source} has {value!r}, expected {version!r}")
    if tag is not None and tag != f"v{version}":
        errors.append(f"release tag {tag!r} must equal 'v{version}'")
    if tag is not None:
        changelog = CHANGELOG.read_text(encoding="utf-8")
        if not re.search(rf"^## \[{re.escape(version)}\] - \d{{4}}-\d{{2}}-\d{{2}}$", changelog, re.MULTILINE):
            errors.append(f"CHANGELOG.md must contain a dated [{version}] release section")
    if errors:
        raise VersionError("Version check failed:\n- " + "\n- ".join(errors))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("show", help="print the canonical version")
    subparsers.add_parser("sync", help="write VERSION into frontend manifests")
    check = subparsers.add_parser("check", help="verify all manifests and an optional release tag")
    check.add_argument("--tag", help="release tag to compare with VERSION, for example v0.3.0")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        version = read_version()
        if args.command == "show":
            print(version)
        elif args.command == "sync":
            sync_manifests(version)
            check_manifests(version)
            print(f"Synchronized Love Book version {version}")
        else:
            check_manifests(version, args.tag)
            print(f"Love Book version {version} is consistent")
    except (OSError, json.JSONDecodeError, VersionError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
