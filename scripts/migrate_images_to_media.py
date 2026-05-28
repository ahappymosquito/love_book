"""Manual migration script: export images.data/thumb_data BLOBs to MEDIA_ROOT and backfill storage keys.

Usage from the project root:

    python scripts/migrate_images_to_media.py
    python scripts/migrate_images_to_media.py --clear-blobs --compact

The default run writes original images and thumbnails to local media storage and keeps legacy BLOBs.
Use --clear-blobs only after a successful default run and backup verification.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from dotenv import load_dotenv
from sqlalchemy import select, text
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(PROJECT_ROOT / ".env", override=True)

from app.core.database import SessionLocal, engine, init_db  # noqa: E402
from app.media import MediaProcessingError, make_image_thumbnail  # noqa: E402
from app.models import Event, Image  # noqa: E402
from app.storage import image_extension_for_mime, media_file_exists, write_media_file  # noqa: E402


@dataclass
class MigrationStats:
    originals_written: int = 0
    thumbs_written: int = 0
    rows_updated: int = 0
    blobs_cleared: int = 0
    missing_files: int = 0
    skipped_without_blob: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Move legacy image BLOBs into MEDIA_ROOT local storage.")
    parser.add_argument("--clear-blobs", action="store_true", help="Set images.data/thumb_data to NULL after files verify.")
    parser.add_argument("--compact", action="store_true", help="Run database space recovery after changes.")
    return parser.parse_args()


def deterministic_stem(image_id: int, kind: str) -> str:
    return uuid5(NAMESPACE_URL, f"love-book:image:{image_id}:{kind}").hex


def original_key(pair_id: int, event_id: int, image: Image) -> str:
    return (
        f"images/originals/{pair_id}/{event_id}/"
        f"{deterministic_stem(image.id, 'original')}{image_extension_for_mime(image.mime_type)}"
    )


def thumb_key(pair_id: int, event_id: int, image: Image) -> str:
    return f"images/thumbs/{pair_id}/{event_id}/{deterministic_stem(image.id, 'thumb')}.jpg"


def export_images(session: Session) -> MigrationStats:
    stats = MigrationStats()
    rows = session.execute(
        select(Image, Event.pair_id).join(Event, Image.event_id == Event.id).order_by(Image.id)
    ).all()

    for image, pair_id in rows:
        changed = False

        if image.data:
            if not image.storage_key:
                image.storage_key = original_key(pair_id, image.event_id, image)
                changed = True
            if not media_file_exists(image.storage_key):
                write_media_file(image.storage_key, bytes(image.data))
                stats.originals_written += 1

        thumb_bytes = bytes(image.thumb_data) if image.thumb_data else None
        if thumb_bytes is None and image.data:
            try:
                thumb_bytes = make_image_thumbnail(bytes(image.data))
            except MediaProcessingError as exc:
                print(f"Image {image.id}: skipped thumbnail generation: {exc}")

        if thumb_bytes:
            if not image.thumb_storage_key:
                image.thumb_storage_key = thumb_key(pair_id, image.event_id, image)
                changed = True
            if not media_file_exists(image.thumb_storage_key):
                write_media_file(image.thumb_storage_key, thumb_bytes)
                stats.thumbs_written += 1
            if image.thumb_mime_type != "image/jpeg":
                image.thumb_mime_type = "image/jpeg"
                changed = True
            if image.thumb_size_bytes != len(thumb_bytes):
                image.thumb_size_bytes = len(thumb_bytes)
                changed = True

        if image.storage_key or image.thumb_storage_key:
            if image.storage_backend != "local":
                image.storage_backend = "local"
                changed = True
        elif not image.data and not image.thumb_data:
            stats.skipped_without_blob += 1

        if changed:
            stats.rows_updated += 1

    session.commit()
    return stats


def verify_files(session: Session) -> int:
    missing = 0
    rows = session.execute(select(Image).order_by(Image.id)).scalars().all()
    for image in rows:
        if image.storage_key and not media_file_exists(image.storage_key):
            print(f"Image {image.id}: missing original file for {image.storage_key}")
            missing += 1
        if image.thumb_storage_key and not media_file_exists(image.thumb_storage_key):
            print(f"Image {image.id}: missing thumbnail file for {image.thumb_storage_key}")
            missing += 1
    return missing


def clear_legacy_blobs(session: Session) -> int:
    cleared = 0
    rows = session.execute(select(Image).order_by(Image.id)).scalars().all()
    for image in rows:
        changed = False
        if image.data and image.storage_key and media_file_exists(image.storage_key):
            image.data = None
            changed = True
        if image.thumb_data and image.thumb_storage_key and media_file_exists(image.thumb_storage_key):
            image.thumb_data = None
            changed = True
        if changed:
            cleared += 1
    session.commit()
    return cleared


def compact_database() -> None:
    dialect = engine.dialect.name
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        if dialect == "sqlite":
            connection.execute(text("VACUUM"))
        elif dialect in {"mysql", "mariadb"}:
            connection.execute(text("OPTIMIZE TABLE images"))
        else:
            print(f"Skipping compact: unsupported dialect {dialect!r}")


def main() -> int:
    args = parse_args()
    init_db()
    with SessionLocal() as session:
        stats = export_images(session)
        stats.missing_files = verify_files(session)
        if stats.missing_files:
            print(f"Verification failed: {stats.missing_files} media files are missing.")
            return 1
        if args.clear_blobs:
            stats.blobs_cleared = clear_legacy_blobs(session)

    if args.compact:
        compact_database()

    print(
        "Done. "
        f"Originals written: {stats.originals_written}; "
        f"thumbnails written: {stats.thumbs_written}; "
        f"rows updated: {stats.rows_updated}; "
        f"rows skipped without BLOB: {stats.skipped_without_blob}; "
        f"rows with BLOBs cleared: {stats.blobs_cleared}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
