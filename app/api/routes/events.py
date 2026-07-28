"""Event routes for CRUD, atomic received-gift creation, meeting classification, notifications, and legacy receipt links.

Mutation endpoints commit before returning so the frontend can immediately reload the new or changed event.
"""

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import delete_legacy_voice_rows, get_db
from app.emailer import notify_event_created
from app.media import MediaProcessingError, make_image_thumbnail
from app.models import Event, EventKind, GiftFeeling, Image, LoveReceipt, User, VisibilityMode, utc_now
from app.schemas import EventCreate, EventDetail, EventSummary, EventUpdate
from app.services import active_token_for_user, counterpart, ensure_pair_event, ensure_pair_meeting_session, event_detail, event_summary, find_meeting_for_date, get_or_create_single_day_meeting, meeting_date_for_values
from app.storage import MediaStorageError, build_image_storage_keys, delete_media_file, write_media_file

router = APIRouter(prefix="/events", tags=["events"])


def _queue_event_notification(
    background: BackgroundTasks,
    *,
    db: Session,
    event: Event,
    current_user: User,
    other: User,
    content_unlocked: bool,
) -> None:
    background.add_task(
        notify_event_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=active_token_for_user(db, other.id),
        actor_name=current_user.display_name,
        event_id=event.id,
        event_title=event.title,
        event_description=event.description,
        content_unlocked=content_unlocked,
    )


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    if payload.gift_rating is not None and payload.event_kind != EventKind.gift_received:
        raise HTTPException(status_code=422, detail="Only received-gift events can have a rating")
    if payload.gift_feelings and payload.event_kind != EventKind.gift_received:
        raise HTTPException(status_code=422, detail="Only received-gift events can have feelings")
    if payload.meeting_session_id is not None:
        ensure_pair_meeting_session(db, payload.meeting_session_id, pair)
    explicitly_offline = payload.event_kind == EventKind.offline_meeting or payload.meeting_session_id is not None
    created_at = utc_now()
    event_date = meeting_date_for_values(payload.occurred_at, created_at)
    meeting_session = find_meeting_for_date(db, pair.id, event_date)
    if meeting_session is None and explicitly_offline:
        meeting_session = get_or_create_single_day_meeting(
            db,
            pair,
            current_user,
            payload.title,
            event_date,
        )
    meeting_session_id = meeting_session.id if meeting_session is not None else None
    event_kind = (
        EventKind.gift_received
        if payload.event_kind == EventKind.gift_received
        else EventKind.offline_meeting if meeting_session is not None else EventKind.memory
    )
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting_session_id,
        title=payload.title,
        description=payload.description,
        occurred_at=payload.occurred_at,
        event_kind=event_kind,
        gift_rating=payload.gift_rating,
        gift_feelings=[feeling.value for feeling in payload.gift_feelings],
        visibility_mode=payload.visibility_mode,
        created_at=created_at,
    )
    db.add(event)
    db.flush()
    db.refresh(event)
    other = counterpart(pair, current_user)
    db.commit()
    db.refresh(event)
    detail = event_detail(db, event, current_user, pair)
    _queue_event_notification(
        background,
        db=db,
        event=event,
        current_user=current_user,
        other=other,
        content_unlocked=detail.submission_state.unlocked,
    )
    return detail


@router.post("/gifts", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_received_gift(
    background: BackgroundTasks,
    title: str = Form(...),
    feedback: str = Form(default=""),
    feeling: str = Form(default=""),
    feelings: list[GiftFeeling] = Form(default=[]),
    occurred_at: datetime | None = Form(default=None),
    rating: int | None = Form(default=None, ge=1, le=5),
    files: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    """Create a received-gift event and up to six private images as one committed operation."""
    clean_title = title.strip()
    clean_feedback = (feedback or feeling).strip()
    if not clean_title or len(clean_title) > 200:
        raise HTTPException(status_code=422, detail="Gift title must contain 1 to 200 characters")
    if len(clean_feedback) > 2000:
        raise HTTPException(status_code=422, detail="Gift feedback must be at most 2000 characters")
    if len(feelings) > 3 or len(set(feelings)) != len(feelings):
        raise HTTPException(status_code=422, detail="Choose up to 3 unique gift feelings")
    if len(files) > 6:
        raise HTTPException(status_code=422, detail="A received gift supports at most 6 images")

    pair = get_pair_for_user(db, current_user.id)
    settings = get_settings()
    created_at = utc_now()
    event_date = meeting_date_for_values(occurred_at, created_at)
    meeting = find_meeting_for_date(db, pair.id, event_date)
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting.id if meeting else None,
        title=clean_title,
        description=clean_feedback or None,
        occurred_at=occurred_at,
        event_kind=EventKind.gift_received,
        gift_rating=rating,
        gift_feelings=[item.value for item in feelings],
        visibility_mode=VisibilityMode.public,
        created_at=created_at,
    )
    written_keys: list[str] = []
    try:
        db.add(event)
        db.flush()
        for image_order, upload in enumerate(files):
            content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
            if content_type not in settings.allowed_image_mime_types:
                raise HTTPException(status_code=415, detail="Unsupported image mime type")
            body = upload.file.read(settings.max_image_bytes + 1)
            if len(body) > settings.max_image_bytes:
                raise HTTPException(status_code=413, detail="Image file is too large")
            try:
                thumb = make_image_thumbnail(body)
            except MediaProcessingError as exc:
                raise HTTPException(status_code=422, detail=f"Image thumbnail could not be generated: {exc}") from exc
            storage_key, thumb_key = build_image_storage_keys(pair.id, event.id, content_type)
            write_media_file(storage_key, body)
            written_keys.append(storage_key)
            write_media_file(thumb_key, thumb)
            written_keys.append(thumb_key)
            db.add(
                Image(
                    event_id=event.id,
                    author_id=current_user.id,
                    sort_order=image_order,
                    file_path="",
                    storage_key=storage_key,
                    thumb_storage_key=thumb_key,
                    storage_backend=settings.media_storage,
                    data=None,
                    thumb_data=None,
                    thumb_mime_type="image/jpeg",
                    thumb_size_bytes=len(thumb),
                    mime_type=content_type,
                    size_bytes=len(body),
                )
            )
        other = counterpart(pair, current_user)
        db.commit()
    except HTTPException:
        db.rollback()
        for key in written_keys:
            try:
                delete_media_file(key)
            except (MediaStorageError, OSError):
                pass
        raise
    except (MediaStorageError, OSError) as exc:
        db.rollback()
        for key in written_keys:
            try:
                delete_media_file(key)
            except (MediaStorageError, OSError):
                pass
        raise HTTPException(status_code=500, detail=f"Gift image could not be saved: {exc}") from exc
    except Exception:
        db.rollback()
        for key in written_keys:
            try:
                delete_media_file(key)
            except (MediaStorageError, OSError):
                pass
        raise

    db.refresh(event)
    detail = event_detail(db, event, current_user, pair)
    _queue_event_notification(
        background,
        db=db,
        event=event,
        current_user=current_user,
        other=other,
        content_unlocked=True,
    )
    return detail


@router.get("", response_model=list[EventSummary])
def list_events(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[EventSummary]:
    pair = get_pair_for_user(db, current_user.id)
    events = db.execute(select(Event).where(Event.pair_id == pair.id).order_by(Event.created_at.desc())).scalars().all()
    return [event_summary(db, event, current_user, pair) for event in events]


@router.get("/{event_id}", response_model=EventDetail)
def get_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    return event_detail(db, event, current_user, pair)


@router.patch("/{event_id}", response_model=EventDetail)
def update_event(
    event_id: int,
    payload: EventUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    updates = payload.model_dump(exclude_unset=True)
    classification_update_only = set(updates) <= {"meeting_session_id"}
    if event.creator_id != current_user.id and not classification_update_only:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator can update this event")

    is_gift = event.event_kind == EventKind.gift_received
    if updates.get("event_kind") == EventKind.gift_received:
        is_gift = True
    if "gift_rating" in updates and updates["gift_rating"] is not None and not is_gift:
        raise HTTPException(status_code=422, detail="Only received-gift events can have a rating")
    if updates.get("gift_feelings") and not is_gift:
        raise HTTPException(status_code=422, detail="Only received-gift events can have feelings")
    if "gift_feelings" in updates:
        updates["gift_feelings"] = [
            feeling.value if isinstance(feeling, GiftFeeling) else feeling
            for feeling in (updates["gift_feelings"] or [])
        ]

    if "meeting_session_id" in updates:
        if updates["meeting_session_id"] is not None:
            ensure_pair_meeting_session(db, updates["meeting_session_id"], pair)
            updates["event_kind"] = EventKind.gift_received if is_gift else EventKind.offline_meeting

    explicitly_offline = (
        updates.get("event_kind") == EventKind.offline_meeting
        or updates.get("meeting_session_id") is not None
    )
    event_date = meeting_date_for_values(
        updates.get("occurred_at", event.occurred_at),
        event.created_at,
    )
    meeting_session = find_meeting_for_date(db, pair.id, event_date)
    if meeting_session is None and explicitly_offline:
        meeting_session = get_or_create_single_day_meeting(
            db,
            pair,
            current_user,
            updates.get("title", event.title),
            event_date,
        )
    if meeting_session is not None:
        updates["event_kind"] = EventKind.gift_received if is_gift else EventKind.offline_meeting
        updates["meeting_session_id"] = meeting_session.id
    else:
        updates["event_kind"] = EventKind.gift_received if is_gift else EventKind.memory
        updates["meeting_session_id"] = None

    for field, value in updates.items():
        setattr(event, field, value)
    db.flush()
    db.commit()
    db.refresh(event)
    return event_detail(db, event, current_user, pair)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    if event.creator_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator can delete this event")
    delete_legacy_voice_rows(db, event.id)
    db.execute(
        update(LoveReceipt)
        .where(LoveReceipt.timeline_event_id == event.id)
        .values(timeline_event_id=None)
    )
    db.delete(event)
    db.flush()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
