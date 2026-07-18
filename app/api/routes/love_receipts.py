"""Pair-private love-receipt CRUD, forward-only state transitions, atomic receipt media, and timeline completion."""

from datetime import date, datetime, time, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.emailer import notify_love_receipt_completed, notify_love_receipt_created
from app.media import MediaProcessingError, make_image_thumbnail
from app.models import (
    Event,
    EventKind,
    LoveReceipt,
    LoveReceiptImage,
    LoveReceiptImageKind,
    LoveReceiptMood,
    LoveReceiptStatus,
    LoveReceiptType,
    User,
    VisibilityMode,
    utc_now,
)
from app.schemas import LoveReceiptImageOut, LoveReceiptListOut, LoveReceiptOut, LoveReceiptStatusUpdate, UserOut
from app.services import active_token_for_user, counterpart
from app.storage import (
    PRIVATE_MEDIA_CACHE_HEADERS,
    MediaStorageError,
    build_love_receipt_image_storage_keys,
    delete_media_file,
    read_media_file,
    write_media_file,
)

router = APIRouter(prefix="/love-receipts", tags=["love-receipts"])
image_router = APIRouter(prefix="/love-receipt-images", tags=["love-receipt-images"])


def _ensure_receipt(db: Session, receipt_id: int, pair_id: int) -> LoveReceipt:
    receipt = db.get(LoveReceipt, receipt_id)
    if receipt is None or receipt.pair_id != pair_id:
        raise HTTPException(status_code=404, detail="Love receipt not found")
    return receipt


def _receipt_out(receipt: LoveReceipt, current_user: User) -> LoveReceiptOut:
    ordered = sorted(receipt.images, key=lambda image: (image.sort_order, image.id))
    cover = next((image for image in ordered if image.kind == LoveReceiptImageKind.cover), None)
    response_images = [image for image in ordered if image.kind == LoveReceiptImageKind.receipt]
    return LoveReceiptOut(
        id=receipt.id,
        pair_id=receipt.pair_id,
        sender_id=receipt.sender_id,
        receiver_id=receipt.receiver_id,
        sender=UserOut.model_validate(receipt.sender),
        receiver=UserOut.model_validate(receipt.receiver),
        viewer_role="sender" if receipt.sender_id == current_user.id else "receiver",
        receipt_type=receipt.receipt_type,
        title=receipt.title,
        message=receipt.message,
        expected_arrival_at=receipt.expected_arrival_at,
        delivered_at=receipt.delivered_at,
        received_at=receipt.received_at,
        status=receipt.status,
        require_receipt=receipt.require_receipt,
        receipt_content=receipt.receipt_content,
        receipt_mood=receipt.receipt_mood,
        completed_at=receipt.completed_at,
        timeline_event_id=receipt.timeline_event_id,
        cover=LoveReceiptImageOut.model_validate(cover) if cover else None,
        receipt_images=[LoveReceiptImageOut.model_validate(image) for image in response_images],
        created_at=receipt.created_at,
        updated_at=receipt.updated_at,
    )


def _validate_upload(file: UploadFile) -> tuple[bytes, bytes, str]:
    settings = get_settings()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=415, detail="Unsupported image mime type")
    body = file.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="Image file is too large")
    try:
        thumb = make_image_thumbnail(body)
    except MediaProcessingError as exc:
        raise HTTPException(status_code=422, detail=f"Image thumbnail could not be generated: {exc}") from exc
    return body, thumb, content_type


def _write_image(
    *,
    db: Session,
    receipt: LoveReceipt,
    author: User,
    upload: UploadFile,
    kind: LoveReceiptImageKind,
    sort_order: int,
) -> tuple[LoveReceiptImage, list[str]]:
    body, thumb, content_type = _validate_upload(upload)
    storage_key, thumb_key = build_love_receipt_image_storage_keys(
        receipt.pair_id, receipt.id, kind.value, content_type
    )
    written: list[str] = []
    try:
        write_media_file(storage_key, body)
        written.append(storage_key)
        write_media_file(thumb_key, thumb)
        written.append(thumb_key)
    except (MediaStorageError, OSError) as exc:
        for key in written:
            try:
                delete_media_file(key)
            except (MediaStorageError, OSError):
                pass
        raise HTTPException(status_code=500, detail=f"Image file could not be saved: {exc}") from exc
    image = LoveReceiptImage(
        love_receipt_id=receipt.id,
        author_id=author.id,
        kind=kind,
        sort_order=sort_order,
        storage_key=storage_key,
        thumb_storage_key=thumb_key,
        storage_backend=get_settings().media_storage,
        mime_type=content_type,
        size_bytes=len(body),
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=len(thumb),
    )
    db.add(image)
    return image, written


def _cleanup(keys: list[str]) -> None:
    for key in keys:
        try:
            delete_media_file(key)
        except (MediaStorageError, OSError):
            pass


def _create_timeline_memory(db: Session, receipt: LoveReceipt, actor: User) -> None:
    if receipt.timeline_event_id is not None:
        return
    response = receipt.receipt_content.strip() if receipt.receipt_content else "已经认真收到这份心意。"
    description = f"{receipt.sender.display_name} 送来的心意，被 {receipt.receiver.display_name} 好好接住了。\n\n{response}"
    event = Event(
        pair_id=receipt.pair_id,
        creator_id=actor.id,
        title=f"爱的回执：{receipt.title}",
        description=description,
        occurred_at=receipt.completed_at,
        event_kind=EventKind.memory,
        visibility_mode=VisibilityMode.public,
    )
    db.add(event)
    db.flush()
    receipt.timeline_event_id = event.id


@router.get("", response_model=LoveReceiptListOut)
def list_love_receipts(
    view: Literal["all", "pending", "active", "completed"] = "all",
    receipt_status: LoveReceiptStatus | None = Query(default=None, alias="status"),
    receipt_type: LoveReceiptType | None = Query(default=None, alias="type"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    date_from: date | None = None,
    date_to: date | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptListOut:
    pair = get_pair_for_user(db, current_user.id)
    conditions = [LoveReceipt.pair_id == pair.id]
    if view == "pending":
        conditions.extend(
            [LoveReceipt.receiver_id == current_user.id, LoveReceipt.status != LoveReceiptStatus.completed]
        )
    elif view == "active":
        conditions.append(LoveReceipt.status != LoveReceiptStatus.completed)
    elif view == "completed":
        conditions.append(LoveReceipt.status == LoveReceiptStatus.completed)
    if receipt_status is not None:
        conditions.append(LoveReceipt.status == receipt_status)
    if receipt_type is not None:
        conditions.append(LoveReceipt.receipt_type == receipt_type)
    if date_from is not None:
        conditions.append(LoveReceipt.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to is not None:
        conditions.append(LoveReceipt.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))

    total = int(db.scalar(select(func.count()).select_from(LoveReceipt).where(*conditions)) or 0)
    items = (
        db.execute(
            select(LoveReceipt)
            .where(*conditions)
            .order_by(LoveReceipt.completed_at.desc().nullslast(), LoveReceipt.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    now = utc_now()
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    pending_count = int(
        db.scalar(
            select(func.count()).select_from(LoveReceipt).where(
                LoveReceipt.pair_id == pair.id,
                LoveReceipt.receiver_id == current_user.id,
                LoveReceipt.status != LoveReceiptStatus.completed,
            )
        )
        or 0
    )
    completed_count = int(
        db.scalar(
            select(func.count()).select_from(LoveReceipt).where(
                LoveReceipt.pair_id == pair.id, LoveReceipt.status == LoveReceiptStatus.completed
            )
        )
        or 0
    )
    month_count = int(
        db.scalar(
            select(func.count()).select_from(LoveReceipt).where(
                LoveReceipt.pair_id == pair.id, LoveReceipt.created_at >= month_start
            )
        )
        or 0
    )
    latest = db.execute(
        select(LoveReceipt.status)
        .where(LoveReceipt.pair_id == pair.id)
        .order_by(LoveReceipt.updated_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return LoveReceiptListOut(
        items=[_receipt_out(item, current_user) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pending_count=pending_count,
        completed_count=completed_count,
        month_count=month_count,
        latest_status=latest,
    )


@router.post("", response_model=LoveReceiptOut, status_code=status.HTTP_201_CREATED)
def create_love_receipt(
    background: BackgroundTasks,
    receipt_type: LoveReceiptType = Form(...),
    title: str = Form(...),
    message: str = Form(default=""),
    expected_arrival_at: datetime | None = Form(default=None),
    require_receipt: bool = Form(default=True),
    cover: UploadFile | None = File(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptOut:
    clean_title = title.strip()
    clean_message = message.strip()
    if not clean_title or len(clean_title) > 200:
        raise HTTPException(status_code=422, detail="Title must contain 1 to 200 characters")
    if len(clean_message) > 2000:
        raise HTTPException(status_code=422, detail="Message must be at most 2000 characters")
    pair = get_pair_for_user(db, current_user.id)
    other = counterpart(pair, current_user)
    receipt = LoveReceipt(
        pair_id=pair.id,
        sender_id=current_user.id,
        receiver_id=other.id,
        receipt_type=receipt_type,
        title=clean_title,
        message=clean_message,
        expected_arrival_at=expected_arrival_at,
        require_receipt=require_receipt,
    )
    written: list[str] = []
    try:
        db.add(receipt)
        db.flush()
        if cover is not None:
            _, keys = _write_image(
                db=db, receipt=receipt, author=current_user, upload=cover, kind=LoveReceiptImageKind.cover, sort_order=0
            )
            written.extend(keys)
        recipient_token = active_token_for_user(db, other.id)
        db.commit()
    except HTTPException:
        db.rollback()
        _cleanup(written)
        raise
    except Exception:
        db.rollback()
        _cleanup(written)
        raise
    db.refresh(receipt)
    background.add_task(
        notify_love_receipt_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=recipient_token,
        actor_name=current_user.display_name,
        receipt_id=receipt.id,
        receipt_title=receipt.title,
    )
    return _receipt_out(receipt, current_user)


@router.get("/{receipt_id}", response_model=LoveReceiptOut)
def get_love_receipt(
    receipt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptOut:
    pair = get_pair_for_user(db, current_user.id)
    return _receipt_out(_ensure_receipt(db, receipt_id, pair.id), current_user)


@router.patch("/{receipt_id}/status", response_model=LoveReceiptOut)
def update_love_receipt_status(
    receipt_id: int,
    payload: LoveReceiptStatusUpdate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptOut:
    pair = get_pair_for_user(db, current_user.id)
    receipt = _ensure_receipt(db, receipt_id, pair.id)
    if receipt.status == LoveReceiptStatus.completed:
        raise HTTPException(status_code=409, detail="Love receipt is already completed")
    now = utc_now()
    completed_now = False
    if payload.status in {LoveReceiptStatus.delivering, LoveReceiptStatus.delivered}:
        if receipt.sender_id != current_user.id:
            raise HTTPException(status_code=403, detail="Only the sender can update delivery status")
        allowed = {
            LoveReceiptStatus.created: {LoveReceiptStatus.delivering, LoveReceiptStatus.delivered},
            LoveReceiptStatus.delivering: {LoveReceiptStatus.delivered},
        }
        if payload.status not in allowed.get(receipt.status, set()):
            raise HTTPException(status_code=409, detail="Invalid love receipt status transition")
        receipt.status = LoveReceiptStatus(payload.status)
        if receipt.status == LoveReceiptStatus.delivered:
            receipt.delivered_at = now
    else:
        if receipt.receiver_id != current_user.id:
            raise HTTPException(status_code=403, detail="Only the receiver can confirm this gesture")
        receipt.received_at = receipt.received_at or now
        receipt.delivered_at = receipt.delivered_at or now
        if receipt.require_receipt:
            receipt.status = LoveReceiptStatus.waiting_receipt
        else:
            receipt.status = LoveReceiptStatus.completed
            receipt.completed_at = now
            _create_timeline_memory(db, receipt, current_user)
            completed_now = True
    sender_token = active_token_for_user(db, receipt.sender_id) if completed_now else None
    db.commit()
    db.refresh(receipt)
    if completed_now:
        background.add_task(
            notify_love_receipt_completed,
            recipient_email=receipt.sender.email,
            recipient_name=receipt.sender.display_name,
            recipient_token=sender_token,
            actor_name=receipt.receiver.display_name,
            receipt_id=receipt.id,
            receipt_title=receipt.title,
        )
    return _receipt_out(receipt, current_user)


@router.post("/{receipt_id}/receipt", response_model=LoveReceiptOut)
def submit_love_receipt(
    receipt_id: int,
    background: BackgroundTasks,
    content: str = Form(...),
    mood: LoveReceiptMood | None = Form(default=None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptOut:
    pair = get_pair_for_user(db, current_user.id)
    receipt = _ensure_receipt(db, receipt_id, pair.id)
    if receipt.receiver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the receiver can submit a receipt")
    if receipt.status == LoveReceiptStatus.completed:
        raise HTTPException(status_code=409, detail="Love receipt is already completed")
    if receipt.status != LoveReceiptStatus.waiting_receipt or not receipt.require_receipt:
        raise HTTPException(status_code=409, detail="Love receipt is not ready for a photo response")
    clean_content = content.strip()
    if not clean_content or len(clean_content) > 100:
        raise HTTPException(status_code=422, detail="Receipt response must contain 1 to 100 characters")
    if not 1 <= len(files) <= 3:
        raise HTTPException(status_code=422, detail="Receipt requires 1 to 3 images")

    written: list[str] = []
    try:
        for index, upload in enumerate(files):
            _, keys = _write_image(
                db=db,
                receipt=receipt,
                author=current_user,
                upload=upload,
                kind=LoveReceiptImageKind.receipt,
                sort_order=index,
            )
            written.extend(keys)
        now = utc_now()
        receipt.receipt_content = clean_content
        receipt.receipt_mood = mood
        receipt.received_at = receipt.received_at or now
        receipt.delivered_at = receipt.delivered_at or now
        receipt.completed_at = now
        receipt.status = LoveReceiptStatus.completed
        _create_timeline_memory(db, receipt, current_user)
        sender_token = active_token_for_user(db, receipt.sender_id)
        db.commit()
    except HTTPException:
        db.rollback()
        _cleanup(written)
        raise
    except Exception:
        db.rollback()
        _cleanup(written)
        raise
    db.refresh(receipt)
    background.add_task(
        notify_love_receipt_completed,
        recipient_email=receipt.sender.email,
        recipient_name=receipt.sender.display_name,
        recipient_token=sender_token,
        actor_name=receipt.receiver.display_name,
        receipt_id=receipt.id,
        receipt_title=receipt.title,
    )
    return _receipt_out(receipt, current_user)


def _visible_image(db: Session, image_id: int, current_user: User) -> LoveReceiptImage:
    pair = get_pair_for_user(db, current_user.id)
    image = db.get(LoveReceiptImage, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Love receipt image not found")
    _ensure_receipt(db, image.love_receipt_id, pair.id)
    return image


@image_router.get("/{image_id}/file")
def get_love_receipt_image(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    image = _visible_image(db, image_id, current_user)
    body = read_media_file(image.storage_key)
    if body is None:
        raise HTTPException(status_code=404, detail="Love receipt image file not found")
    return Response(body, media_type=image.mime_type, headers=PRIVATE_MEDIA_CACHE_HEADERS)


@image_router.get("/{image_id}/thumb")
def get_love_receipt_thumbnail(
    image_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    image = _visible_image(db, image_id, current_user)
    body = read_media_file(image.thumb_storage_key)
    if body is None:
        raise HTTPException(status_code=404, detail="Love receipt thumbnail not found")
    return Response(body, media_type=image.thumb_mime_type, headers=PRIVATE_MEDIA_CACHE_HEADERS)
