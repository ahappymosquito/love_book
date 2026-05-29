"""Content route handlers for comments, local MP3 voice/image storage, and filtered media downloads.

Creation endpoints commit before returning so detail pages can refresh content immediately after a submit.
"""

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.emailer import notify_comment_created
from app.media import MediaProcessingError, make_image_thumbnail, normalize_voice_to_mp3
from app.models import Comment, Image, User, Voice
from app.schemas import CommentCreate, CommentOut, ContentsOut, ImageOut, VoiceOut
from app.services import (
    active_token_for_user,
    counterpart,
    ensure_image_file_visible,
    ensure_pair_event,
    ensure_voice_file_visible,
    submission_state,
    visible_contents,
)
from app.storage import (
    PRIVATE_MEDIA_CACHE_HEADERS,
    MediaStorageError,
    build_image_storage_keys,
    build_voice_storage_key,
    read_media_file,
    write_media_file,
)

router = APIRouter(tags=["contents"])


@router.post("/events/{event_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(
    event_id: int,
    payload: CommentCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommentOut:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    comment = Comment(event_id=event_id, author_id=current_user.id, text=payload.text)
    db.add(comment)
    db.flush()
    db.refresh(comment)
    other = counterpart(pair, current_user)
    recipient_token = active_token_for_user(db, other.id)
    content_unlocked = submission_state(db, event, other, pair).unlocked
    db.commit()
    db.refresh(comment)
    background.add_task(
        notify_comment_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=recipient_token,
        actor_name=current_user.display_name,
        event_id=event.id,
        event_title=event.title,
        comment_text=comment.text,
        content_unlocked=content_unlocked,
    )
    return CommentOut.model_validate(comment)


@router.post("/events/{event_id}/voices", response_model=VoiceOut, status_code=status.HTTP_201_CREATED)
def upload_voice(
    event_id: int,
    file: UploadFile = File(...),
    duration_ms: int | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceOut:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    settings = get_settings()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_voice_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported audio mime type")

    body = file.file.read(settings.max_voice_bytes + 1)
    if len(body) > settings.max_voice_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Voice file is too large")
    try:
        body = normalize_voice_to_mp3(body, content_type)
    except MediaProcessingError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Voice audio could not be converted to MP3: {exc}",
        ) from exc

    storage_key = build_voice_storage_key(pair.id, event.id)
    try:
        write_media_file(storage_key, body)
    except (MediaStorageError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Voice file could not be saved: {exc}") from exc

    voice = Voice(
        event_id=event_id,
        author_id=current_user.id,
        file_path="",
        storage_key=storage_key,
        storage_backend=settings.media_storage,
        data=None,
        duration_ms=duration_ms,
        mime_type="audio/mpeg",
        size_bytes=len(body),
    )
    db.add(voice)
    db.flush()
    db.commit()
    db.refresh(voice)
    return VoiceOut.model_validate(voice)


@router.post("/events/{event_id}/images", response_model=ImageOut, status_code=status.HTTP_201_CREATED)
def upload_image(
    event_id: int,
    file: UploadFile = File(...),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageOut:
    """Store uploaded image bytes under MEDIA_ROOT and save only relative storage keys."""
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    settings = get_settings()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported image mime type")

    body = file.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image file is too large")
    try:
        thumb = make_image_thumbnail(body)
    except MediaProcessingError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Image thumbnail could not be generated: {exc}",
        ) from exc

    storage_key, thumb_storage_key = build_image_storage_keys(pair.id, event.id, content_type)
    try:
        write_media_file(storage_key, body)
        write_media_file(thumb_storage_key, thumb)
    except (MediaStorageError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Image file could not be saved: {exc}") from exc

    image = Image(
        event_id=event_id,
        author_id=current_user.id,
        file_path="",  # 旧列保留占位，新数据不写文件
        storage_key=storage_key,
        thumb_storage_key=thumb_storage_key,
        storage_backend=settings.media_storage,
        data=None,
        thumb_data=None,
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=len(thumb),
        mime_type=content_type or "application/octet-stream",
        size_bytes=len(body),
        width=width,
        height=height,
    )
    db.add(image)
    db.flush()
    db.commit()
    db.refresh(image)
    return ImageOut.model_validate(image)


@router.get("/events/{event_id}/contents", response_model=ContentsOut)
def get_contents(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentsOut:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    return visible_contents(db, event, current_user, pair)


@router.get("/voices/{voice_id}/file")
def get_voice_file(
    voice_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    voice = ensure_voice_file_visible(db, voice_id, current_user, pair)
    if voice.storage_key:
        try:
            stored = read_media_file(voice.storage_key)
        except MediaStorageError as exc:
            raise HTTPException(status_code=500, detail=f"Voice file could not be read: {exc}") from exc
        if stored is not None:
            return Response(
                content=stored,
                media_type=voice.mime_type or "audio/mpeg",
                headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
            )
    return Response(
        content=bytes(voice.data or b""),
        media_type=voice.mime_type,
        headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
    )


@router.get("/images/{image_id}/file")
def get_image_file(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    image = ensure_image_file_visible(db, image_id, current_user, pair)
    media_type = image.mime_type or "application/octet-stream"
    if image.storage_key:
        try:
            stored = read_media_file(image.storage_key)
        except MediaStorageError as exc:
            raise HTTPException(status_code=500, detail=f"Image file could not be read: {exc}") from exc
        if stored is not None:
            return Response(content=stored, media_type=media_type, headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
    if image.data:
        return Response(content=bytes(image.data), media_type=media_type, headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
    # 兼容旧数据：仍走磁盘文件
    if image.file_path and Path(image.file_path).exists():
        return FileResponse(
            path=image.file_path,
            media_type=media_type,
            filename=Path(image.file_path).name,
            headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
        )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")


@router.get("/images/{image_id}/thumb")
def get_image_thumb(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    image = ensure_image_file_visible(db, image_id, current_user, pair)
    if image.thumb_storage_key:
        try:
            stored_thumb = read_media_file(image.thumb_storage_key)
        except MediaStorageError as exc:
            raise HTTPException(status_code=500, detail=f"Image thumbnail could not be read: {exc}") from exc
        if stored_thumb is not None:
            return Response(
                content=stored_thumb,
                media_type=image.thumb_mime_type or "image/jpeg",
                headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
            )
    if not image.thumb_data and image.data:
        try:
            thumb = make_image_thumbnail(bytes(image.data))
        except MediaProcessingError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image thumbnail not found") from exc
        image.thumb_data = thumb
        image.thumb_mime_type = "image/jpeg"
        image.thumb_size_bytes = len(thumb)
        db.add(image)
        db.commit()
        db.refresh(image)
    if image.thumb_data:
        return Response(
            content=bytes(image.thumb_data),
            media_type=image.thumb_mime_type or "image/jpeg",
            headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
        )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image thumbnail not found")
