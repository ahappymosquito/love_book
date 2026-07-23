"""Tests for read-only restore verification and backup-script safety contracts."""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models import Image, LoveReceiptImage, LoveReceiptImageKind, TodoImage, User
from scripts.verify_backup_restore import resolve_media_path, verify_restore


def test_resolve_media_path_rejects_escape(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    media_root.mkdir()

    assert resolve_media_path(media_root, "images/1/photo.jpg") == media_root / "images" / "1" / "photo.jpg"

    for unsafe_key in ("../secret", "/etc/passwd", "images/../../secret", ""):
        try:
            resolve_media_path(media_root, unsafe_key)
        except (ValueError, OSError):
            pass
        else:
            raise AssertionError(f"unsafe storage key was accepted: {unsafe_key!r}")


def test_verify_restore_checks_all_media_models(tmp_path: Path) -> None:
    database_path = tmp_path / "restore.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)

    records = (
        User(id=1, display_name="A", avatar_storage_key="avatars/1/avatar.jpg"),
        Image(
            id=1,
            event_id=1,
            author_id=1,
            storage_key="images/originals/1/1/image.jpg",
            thumb_storage_key="images/thumbs/1/1/image.jpg",
        ),
        TodoImage(
            id=1,
            item_id=1,
            author_id=1,
            storage_key="todo/images/originals/1/1/image.jpg",
            thumb_storage_key="todo/images/thumbs/1/1/image.jpg",
        ),
        LoveReceiptImage(
            id=1,
            love_receipt_id=1,
            author_id=1,
            kind=LoveReceiptImageKind.cover,
            storage_key="love-receipts/cover/originals/1/1/image.jpg",
            thumb_storage_key="love-receipts/cover/thumbs/1/1/image.jpg",
            mime_type="image/jpeg",
            size_bytes=1,
            thumb_size_bytes=1,
        ),
    )
    with Session(engine) as session:
        session.add_all(records)
        session.commit()
    engine.dispose()

    media_root = tmp_path / "media"
    expected_keys = (
        "avatars/1/avatar.jpg",
        "images/originals/1/1/image.jpg",
        "images/thumbs/1/1/image.jpg",
        "todo/images/originals/1/1/image.jpg",
        "todo/images/thumbs/1/1/image.jpg",
        "love-receipts/cover/originals/1/1/image.jpg",
        "love-receipts/cover/thumbs/1/1/image.jpg",
    )
    for storage_key in expected_keys:
        path = media_root.joinpath(*storage_key.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    counts, errors = verify_restore(database_url, media_root)

    assert errors == []
    assert counts["users"] == 1
    assert counts["images"] == 1
    assert counts["todo_images"] == 1
    assert counts["love_receipt_images"] == 1

    (media_root / "todo/images/thumbs/1/1/image.jpg").unlink()
    _, errors = verify_restore(database_url, media_root)
    assert errors == ["todo_images[1].thumb_storage_key: missing todo/images/thumbs/1/1/image.jpg"]
