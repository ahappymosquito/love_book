"""Manual migration script: export voices.data BLOBs to MEDIA_ROOT and backfill storage keys.

Usage from the project root:

    python scripts/migrate_voices_to_media.py
    python scripts/migrate_voices_to_media.py --clear-blobs --compact

The default run writes MP3 voice files to local media storage and keeps legacy BLOBs.
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
from app.models import Event, Voice  # noqa: E402
from app.storage import media_file_exists, write_media_file  # noqa: E402


@dataclass
class MigrationStats:
    voices_written: int = 0
    rows_updated: int = 0
    blobs_cleared: int = 0
    missing_files: int = 0
    skipped_without_blob: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Move legacy voice BLOBs into MEDIA_ROOT local storage.")
    parser.add_argument("--clear-blobs", action="store_true", help="Set voices.data to NULL after files verify.")
    parser.add_argument("--compact", action="store_true", help="Run database space recovery after changes.")
    return parser.parse_args()


def deterministic_stem(voice_id: int) -> str:
    return uuid5(NAMESPACE_URL, f"love-book:voice:{voice_id}:mp3").hex


def voice_key(pair_id: int, event_id: int, voice: Voice) -> str:
    return f"voices/{pair_id}/{event_id}/{deterministic_stem(voice.id)}.mp3"


def export_voices(session: Session) -> MigrationStats:
    stats = MigrationStats()
    rows = session.execute(
        select(Voice, Event.pair_id).join(Event, Voice.event_id == Event.id).order_by(Voice.id)
    ).all()

    for voice, pair_id in rows:
        if not voice.data:
            if not voice.storage_key:
                stats.skipped_without_blob += 1
            continue

        changed = False
        if not voice.storage_key:
            voice.storage_key = voice_key(pair_id, voice.event_id, voice)
            changed = True
        if not media_file_exists(voice.storage_key):
            write_media_file(voice.storage_key, bytes(voice.data))
            stats.voices_written += 1
        if voice.storage_backend != "local":
            voice.storage_backend = "local"
            changed = True
        if voice.mime_type != "audio/mpeg":
            voice.mime_type = "audio/mpeg"
            changed = True
        if voice.size_bytes != len(voice.data):
            voice.size_bytes = len(voice.data)
            changed = True
        if changed:
            stats.rows_updated += 1

    session.commit()
    return stats


def verify_files(session: Session) -> int:
    missing = 0
    rows = session.execute(select(Voice).order_by(Voice.id)).scalars().all()
    for voice in rows:
        if voice.storage_key and not media_file_exists(voice.storage_key):
            print(f"Voice {voice.id}: missing file for {voice.storage_key}")
            missing += 1
    return missing


def clear_legacy_blobs(session: Session) -> int:
    cleared = 0
    rows = session.execute(select(Voice).order_by(Voice.id)).scalars().all()
    for voice in rows:
        if voice.data and voice.storage_key and media_file_exists(voice.storage_key):
            voice.data = None
            cleared += 1
    session.commit()
    return cleared


def compact_database() -> None:
    dialect = engine.dialect.name
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        if dialect == "sqlite":
            connection.execute(text("VACUUM"))
        elif dialect in {"mysql", "mariadb"}:
            connection.execute(text("OPTIMIZE TABLE voices"))
        else:
            print(f"Skipping compact: unsupported dialect {dialect!r}")


def main() -> int:
    args = parse_args()
    init_db()
    with SessionLocal() as session:
        stats = export_voices(session)
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
        f"Voices written: {stats.voices_written}; "
        f"rows updated: {stats.rows_updated}; "
        f"rows skipped without BLOB: {stats.skipped_without_blob}; "
        f"rows with BLOBs cleared: {stats.blobs_cleared}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
