"""Safe local media storage helpers for avatars, timeline, todo, and love-receipt images."""

from pathlib import Path, PurePosixPath
from uuid import uuid4

from app.core.config import Settings, get_settings

PRIVATE_MEDIA_CACHE_HEADERS = {"Cache-Control": "private, max-age=604800"}

IMAGE_EXTENSION_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class MediaStorageError(RuntimeError):
    """Raised when configured media storage cannot safely read or write a key."""


def image_extension_for_mime(mime_type: str | None) -> str:
    return IMAGE_EXTENSION_BY_MIME.get((mime_type or "").split(";", 1)[0].strip().lower(), ".bin")


def build_image_storage_keys(pair_id: int, event_id: int, mime_type: str | None) -> tuple[str, str]:
    stem = uuid4().hex
    ext = image_extension_for_mime(mime_type)
    return (
        f"images/originals/{pair_id}/{event_id}/{stem}{ext}",
        f"images/thumbs/{pair_id}/{event_id}/{stem}.jpg",
    )


def build_legacy_receipt_event_image_storage_keys(
    pair_id: int, event_id: int, legacy_image_id: int, mime_type: str | None
) -> tuple[str, str]:
    """Return deterministic event-media keys so interrupted legacy copies can be retried safely."""
    ext = image_extension_for_mime(mime_type)
    stem = f"legacy-love-receipt-{legacy_image_id}"
    return (
        f"images/originals/{pair_id}/{event_id}/{stem}{ext}",
        f"images/thumbs/{pair_id}/{event_id}/{stem}.jpg",
    )


def build_todo_image_storage_keys(pair_id: int, item_id: int, mime_type: str | None) -> tuple[str, str]:
    stem = uuid4().hex
    ext = image_extension_for_mime(mime_type)
    return (
        f"todo/images/originals/{pair_id}/{item_id}/{stem}{ext}",
        f"todo/images/thumbs/{pair_id}/{item_id}/{stem}.jpg",
    )


def build_love_receipt_image_storage_keys(
    pair_id: int, receipt_id: int, kind: str, mime_type: str | None
) -> tuple[str, str]:
    stem = uuid4().hex
    ext = image_extension_for_mime(mime_type)
    safe_kind = "cover" if kind == "cover" else "receipt"
    return (
        f"love-receipts/{safe_kind}/originals/{pair_id}/{receipt_id}/{stem}{ext}",
        f"love-receipts/{safe_kind}/thumbs/{pair_id}/{receipt_id}/{stem}.jpg",
    )


def build_avatar_storage_key(user_id: int) -> str:
    return f"avatars/{user_id}/{uuid4().hex}.jpg"


def _require_local_storage(settings: Settings | None = None) -> Settings:
    settings = settings or get_settings()
    if settings.media_storage != "local":
        raise MediaStorageError(f"Unsupported MEDIA_STORAGE={settings.media_storage!r}")
    return settings


def _safe_key_parts(storage_key: str) -> tuple[str, ...]:
    key = storage_key.strip().replace("\\", "/")
    path = PurePosixPath(key)
    if not key or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise MediaStorageError("Invalid media storage key")
    return path.parts


def media_path(storage_key: str, settings: Settings | None = None) -> Path:
    settings = _require_local_storage(settings)
    root = Path(settings.media_root).resolve(strict=False)
    target = root.joinpath(*_safe_key_parts(storage_key)).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise MediaStorageError("Media storage key escapes MEDIA_ROOT") from exc
    return target


def write_media_file(storage_key: str, data: bytes, settings: Settings | None = None) -> Path:
    path = media_path(storage_key, settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def read_media_file(storage_key: str, settings: Settings | None = None) -> bytes | None:
    path = media_path(storage_key, settings)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise MediaStorageError(f"Could not read media file {storage_key!r}") from exc


def media_file_exists(storage_key: str, settings: Settings | None = None) -> bool:
    try:
        return media_path(storage_key, settings).is_file()
    except MediaStorageError:
        return False


def delete_media_file(storage_key: str, settings: Settings | None = None) -> bool:
    path = media_path(storage_key, settings)
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise MediaStorageError(f"Could not delete media file {storage_key!r}") from exc
