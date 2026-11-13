"""Read-only legacy love receipts: pair-private list/detail and private images.

Create, status-update, and response endpoints are retired and always answer 410 (received gifts now live
on the timeline); they send no email and write nothing.
"""

from datetime import date, datetime, time, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement, Select

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import (
    LoveReceipt,
    LoveReceiptImage,
    LoveReceiptImageKind,
    LoveReceiptStatus,
    LoveReceiptType,
    User,
    utc_now,
)
from app.schemas import LoveReceiptImageOut, LoveReceiptListOut, LoveReceiptOut, UserOut
from app.storage import PRIVATE_MEDIA_CACHE_HEADERS, read_media_file

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
        receipt_rating=receipt.receipt_rating,
        completed_at=receipt.completed_at,
        timeline_event_id=receipt.timeline_event_id,
        cover=LoveReceiptImageOut.model_validate(cover) if cover else None,
        receipt_images=[LoveReceiptImageOut.model_validate(image) for image in response_images],
        created_at=receipt.created_at,
        updated_at=receipt.updated_at,
    )


def _love_receipt_list_query(conditions: list[ColumnElement[bool]]) -> Select[tuple[LoveReceipt]]:
    return select(LoveReceipt).where(*conditions).order_by(
        LoveReceipt.completed_at.is_(None),
        LoveReceipt.completed_at.desc(),
        LoveReceipt.created_at.desc(),
    )


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
            _love_receipt_list_query(conditions)
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


@router.post("", status_code=status.HTTP_410_GONE)
def create_love_receipt(current_user: User = Depends(get_current_user)) -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Love receipts have moved to received-gift timeline events",
    )


@router.get("/{receipt_id}", response_model=LoveReceiptOut)
def get_love_receipt(
    receipt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoveReceiptOut:
    pair = get_pair_for_user(db, current_user.id)
    return _receipt_out(_ensure_receipt(db, receipt_id, pair.id), current_user)


@router.patch("/{receipt_id}/status", status_code=status.HTTP_410_GONE)
def update_love_receipt_status(receipt_id: int, current_user: User = Depends(get_current_user)) -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Love receipt status updates have been retired",
    )


@router.post("/{receipt_id}/receipt", status_code=status.HTTP_410_GONE)
def submit_love_receipt(receipt_id: int, current_user: User = Depends(get_current_user)) -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Love receipt responses have moved to received-gift timeline events",
    )


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
