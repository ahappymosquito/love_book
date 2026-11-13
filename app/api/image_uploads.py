"""Shared private-image upload pipeline for timeline, gift, and todo images.

Validates MIME type and size, builds a JPEG thumbnail, writes original and thumbnail under MEDIA_ROOT
(never into DB BLOBs), and deletes written files again when a later step or the DB commit fails.
"""

from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
import logging

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.media import MediaProcessingError, make_image_thumbnail
from app.storage import MediaStorageError, delete_media_file, write_media_file

logger = logging.getLogger(__name__)

IMAGE_SAVE_FAILED_DETAIL = "图片暂时没能保存，请稍后再试"


@dataclass(frozen=True)
class StoredImage:
    storage_key: str
    thumb_storage_key: str
    mime_type: str
    size_bytes: int
    thumb_size_bytes: int

    @property
    def keys(self) -> list[str]:
        return [self.storage_key, self.thumb_storage_key]


def discard_media_files(keys: Iterable[str]) -> None:
    for key in keys:
        try:
            delete_media_file(key)
        except (MediaStorageError, OSError):
            logger.warning("Could not clean up media file %s", key, exc_info=True)


def save_uploaded_image(upload: UploadFile, build_keys: Callable[[str], tuple[str, str]]) -> StoredImage:
    """Validate and persist one upload; `build_keys(mime_type)` returns (original_key, thumb_key)."""
    settings = get_settings()
    content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported image mime type")
    body = upload.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image file is too large")
    try:
        thumb = make_image_thumbnail(body)
    except MediaProcessingError as exc:
        raise HTTPException(status_code=422, detail="这张图片无法识别，换一张试试") from exc

    storage_key, thumb_storage_key = build_keys(content_type)
    written: list[str] = []
    try:
        write_media_file(storage_key, body)
        written.append(storage_key)
        write_media_file(thumb_storage_key, thumb)
        written.append(thumb_storage_key)
    except (MediaStorageError, OSError) as exc:
        logger.exception("Image upload could not be written to media storage")
        discard_media_files(written)
        raise HTTPException(status_code=500, detail=IMAGE_SAVE_FAILED_DETAIL) from exc
    return StoredImage(
        storage_key=storage_key,
        thumb_storage_key=thumb_storage_key,
        mime_type=content_type,
        size_bytes=len(body),
        thumb_size_bytes=len(thumb),
    )


@contextmanager
def discard_media_on_error(db: Session, written_keys: list[str]) -> Iterator[None]:
    """Roll back and delete files written so far if the wrapped DB work (including commit) fails."""
    try:
        yield
    except HTTPException:
        db.rollback()
        discard_media_files(written_keys)
        raise
    except (MediaStorageError, OSError) as exc:
        db.rollback()
        discard_media_files(written_keys)
        logger.exception("Image upload failed after files were written")
        raise HTTPException(status_code=500, detail=IMAGE_SAVE_FAILED_DETAIL) from exc
    except Exception:
        db.rollback()
        discard_media_files(written_keys)
        raise
