"""Audit or apply the idempotent legacy love-receipt to received-gift migration."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(PROJECT_ROOT / ".env", override=False)

from app.core.database import (  # noqa: E402
    SessionLocal,
    _ensure_columns,
    _ensure_received_gift_schema,
    _migrate_love_receipts_to_events,
    engine,
)
from app.models import Event, EventKind, Image, LoveReceipt, LoveReceiptImage  # noqa: E402


def migration_counts() -> dict[str, int]:
    with SessionLocal() as db:
        return {
            "receipts": int(db.scalar(select(func.count()).select_from(LoveReceipt)) or 0),
            "gift_events": int(
                db.scalar(select(func.count()).select_from(Event).where(Event.event_kind == EventKind.gift_received))
                or 0
            ),
            "legacy_images": int(db.scalar(select(func.count()).select_from(LoveReceiptImage)) or 0),
            "mapped_images": int(
                db.scalar(
                    select(func.count()).select_from(Image).where(Image.legacy_love_receipt_image_id.is_not(None))
                )
                or 0
            ),
            "unlinked_receipts": int(
                db.scalar(select(func.count()).select_from(LoveReceipt).where(LoveReceipt.timeline_event_id.is_(None)))
                or 0
            ),
            "unmapped_legacy_images": int(
                db.scalar(
                    select(func.count())
                    .select_from(LoveReceiptImage)
                    .outerjoin(Image, Image.legacy_love_receipt_image_id == LoveReceiptImage.id)
                    .where(Image.id.is_(None))
                )
                or 0
            ),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply schema and data changes; default is dry-run audit.")
    args = parser.parse_args()

    before = migration_counts()
    if not args.apply:
        print(json.dumps({"mode": "dry-run", "before": before}, ensure_ascii=False, indent=2))
        return 0

    _ensure_columns(engine)
    _ensure_received_gift_schema(engine)
    with SessionLocal() as db:
        try:
            _migrate_love_receipts_to_events(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
    after = migration_counts()
    print(json.dumps({"mode": "apply", "before": before, "after": after}, ensure_ascii=False, indent=2))
    return 0 if after["unmapped_legacy_images"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
