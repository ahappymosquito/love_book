from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.emailer import notify_comment_created
from app.models import Comment, Image, User, Voice
from app.schemas import CommentCreate, CommentOut, ContentsOut, ImageOut, VoiceOut
from app.services import (
    active_token_for_user,
    counterpart,
    ensure_image_file_visible,
    ensure_pair_event,
    ensure_voice_file_visible,
    visible_contents,
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
    background.add_task(
        notify_comment_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=recipient_token,
        actor_name=current_user.display_name,
        event_id=event.id,
        event_title=event.title,
        comment_text=comment.text,
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
    ensure_pair_event(db, event_id, pair)
    settings = get_settings()
    if file.content_type not in settings.allowed_voice_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported audio mime type")

    body = file.file.read(settings.max_voice_bytes + 1)
    if len(body) > settings.max_voice_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Voice file is too large")

    suffix = Path(file.filename or "").suffix
    pair_dir = settings.upload_dir / "voices" / f"pair-{pair.id}" / f"event-{event_id}"
    pair_dir.mkdir(parents=True, exist_ok=True)
    target = pair_dir / f"{uuid4().hex}{suffix}"
    target.write_bytes(body)

    voice = Voice(
        event_id=event_id,
        author_id=current_user.id,
        file_path=str(target),
        duration_ms=duration_ms,
        mime_type=file.content_type,
        size_bytes=len(body),
    )
    db.add(voice)
    db.flush()
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
    """图片以 BLOB 形式写入数据库 images.data 列；不再落磁盘。"""
    pair = get_pair_for_user(db, current_user.id)
    ensure_pair_event(db, event_id, pair)
    settings = get_settings()
    if file.content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported image mime type")

    body = file.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image file is too large")

    image = Image(
        event_id=event_id,
        author_id=current_user.id,
        file_path="",  # 旧列保留占位，新数据不写文件
        data=body,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(body),
        width=width,
        height=height,
    )
    db.add(image)
    db.flush()
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
) -> FileResponse:
    pair = get_pair_for_user(db, current_user.id)
    voice = ensure_voice_file_visible(db, voice_id, current_user, pair)
    return FileResponse(path=voice.file_path, media_type=voice.mime_type, filename=Path(voice.file_path).name)


@router.get("/images/{image_id}/file")
def get_image_file(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    image = ensure_image_file_visible(db, image_id, current_user, pair)
    media_type = image.mime_type or "application/octet-stream"
    # 新版数据在 BLOB 中
    if image.data:
        return Response(content=bytes(image.data), media_type=media_type)
    # 兼容旧数据：仍走磁盘文件
    if image.file_path and Path(image.file_path).exists():
        return FileResponse(
            path=image.file_path, media_type=media_type, filename=Path(image.file_path).name
        )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")
