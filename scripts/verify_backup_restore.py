"""Read-only verification of database media references after a Love Book restore rehearsal."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.models import Event, Image, LoveReceipt, LoveReceiptImage, Pair, TodoImage, TodoItem, User


@dataclass(frozen=True)
class MediaReference:
    """One database field that should resolve to a file below MEDIA_ROOT."""

    table: str
    row_id: int
    column: str
    storage_key: str


COUNT_MODELS = (User, Pair, Event, Image, TodoItem, TodoImage, LoveReceipt, LoveReceiptImage)


def collect_media_references(session: Session) -> list[MediaReference]:
    """Collect every current database reference to private local media."""

    references: list[MediaReference] = []
    for user in session.scalars(select(User).order_by(User.id)):
        if user.avatar_storage_key:
            references.append(MediaReference("users", user.id, "avatar_storage_key", user.avatar_storage_key))

    keyed_models = (
        ("images", Image),
        ("todo_images", TodoImage),
        ("love_receipt_images", LoveReceiptImage),
    )
    for table, model in keyed_models:
        for row in session.scalars(select(model).order_by(model.id)):
            for column in ("storage_key", "thumb_storage_key"):
                storage_key = getattr(row, column, None)
                if storage_key:
                    references.append(MediaReference(table, row.id, column, storage_key))
    return references


def resolve_media_path(media_root: Path, storage_key: str) -> Path:
    """Resolve a POSIX storage key without allowing it to escape the media root."""

    normalized = storage_key.strip().replace("\\", "/")
    key_path = PurePosixPath(normalized)
    if not normalized or key_path.is_absolute() or any(part in {"", ".", ".."} for part in key_path.parts):
        raise ValueError("invalid storage key")
    root = media_root.resolve(strict=True)
    target = root.joinpath(*key_path.parts).resolve(strict=False)
    target.relative_to(root)
    return target


def verify_restore(database_url: str, media_root: Path) -> tuple[dict[str, int], list[str]]:
    """Return table counts and media-reference errors without changing restored data."""

    engine = create_engine(database_url)
    errors: list[str] = []
    counts: dict[str, int] = {}
    try:
        with Session(engine) as session:
            for model in COUNT_MODELS:
                counts[model.__tablename__] = session.scalar(select(func.count()).select_from(model)) or 0
            for reference in collect_media_references(session):
                identity = f"{reference.table}[{reference.row_id}].{reference.column}"
                try:
                    path = resolve_media_path(media_root, reference.storage_key)
                except (OSError, ValueError) as exc:
                    errors.append(f"{identity}: unsafe key {reference.storage_key!r}: {exc}")
                    continue
                if not path.is_file():
                    errors.append(f"{identity}: missing {reference.storage_key}")
    finally:
        engine.dispose()
    return counts, errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="restored database SQLAlchemy URL")
    parser.add_argument("--media-root", type=Path, default=Path(os.getenv("MEDIA_ROOT", "/app/media")))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.database_url:
        print("DATABASE_URL or --database-url is required")
        return 2
    try:
        counts, errors = verify_restore(args.database_url, args.media_root)
    except Exception as exc:  # noqa: BLE001 - CLI must report database/filesystem setup failures.
        print(f"Restore verification could not run: {exc}")
        return 2

    print("Restored table counts:")
    for table, count in counts.items():
        print(f"- {table}: {count}")
    if errors:
        print("Media verification failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("All database media references exist below MEDIA_ROOT.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
