"""Event routes for CRUD, wrapped gifts (wrap / open / receiver response), meeting classification, notifications, and legacy receipt links.

Mutation endpoints commit before returning so the frontend can immediately reload the new or changed event.
Gift images go through the shared upload helper, which deletes written files if any later step or the commit fails.
Gift emails never carry title, message, teaser or images. Legacy `gift_received` events stay readable and editable
the old way; new gifts are created only through `POST /events/gifts/wrap`.
PATCH with `event_kind=offline_meeting` on any gift only attaches it to a meeting and keeps the gift kind; a meeting
created this way for a still-wrapped gift gets a neutral title so the receiver can't read the gift name from it.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.api.image_uploads import discard_media_on_error, save_uploaded_image
from app.core.config import get_settings
from app.core.database import delete_legacy_voice_rows, get_db
from app.emailer import notify_event_created, notify_gift_opened, notify_gift_wrapped
from app.models import (
    DEFAULT_GIFT_WRAP_STYLE,
    GIFT_EVENT_KINDS,
    GIFT_WRAP_STYLES,
    Event,
    EventKind,
    GiftFeeling,
    Image,
    LoveReceipt,
    User,
    VisibilityMode,
    utc_now,
)
from app.schemas import EventCreate, EventDetail, EventSummary, EventUpdate, GiftResponseIn
from app.services import (
    active_token_for_user,
    counterpart,
    ensure_pair_event,
    ensure_pair_meeting_session,
    event_detail,
    event_summary,
    find_meeting_for_date,
    get_or_create_single_day_meeting,
    gift_is_wrapped,
    gift_open_time_reached,
    gift_receiver_id,
    is_gift_event,
    meeting_date_for_values,
)
from app.storage import build_image_storage_keys

router = APIRouter(prefix="/events", tags=["events"])

GIFT_CONTENT_FIELDS = {"title", "description", "gift_teaser", "gift_wrap_style", "gift_open_at"}
GIFT_ONLY_FIELDS = {"gift_teaser", "gift_wrap_style", "gift_open_at"}
GIFT_OPENED_EDIT_DETAIL = "礼物已经拆开，内容不能再改"
GIFT_NOT_YET_DETAIL = "还没到拆开的时间"


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


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ensure_pair_gift(db: Session, event_id: int, pair) -> Event:
    event = ensure_pair_event(db, event_id, pair)
    if not is_gift_event(event):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def _ensure_gift_receiver(event: Event, user: User) -> None:
    if gift_receiver_id(event) != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有收礼的人可以这样做")


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    if payload.event_kind == EventKind.gift:
        raise HTTPException(status_code=422, detail="送礼物请使用包礼物入口")
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


@router.post("/gifts/wrap", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def wrap_gift(
    background: BackgroundTasks,
    title: str = Form(...),
    message: str = Form(default=""),
    teaser: str = Form(default=""),
    wrap_style: str = Form(default=""),
    open_at: datetime | None = Form(default=None),
    occurred_at: datetime | None = Form(default=None),
    files: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    """Wrap a gift for the counterpart with up to six private images as one committed operation."""
    clean_title = title.strip()
    clean_message = (message or "").strip()
    clean_teaser = (teaser or "").strip()
    clean_style = (wrap_style or "").strip() or DEFAULT_GIFT_WRAP_STYLE
    if not clean_title or len(clean_title) > 200:
        raise HTTPException(status_code=422, detail="礼物名称需要 1 到 200 个字")
    if len(clean_message) > 2000:
        raise HTTPException(status_code=422, detail="想说的话最多 2000 个字")
    if len(clean_teaser) > 120:
        raise HTTPException(status_code=422, detail="小提示最多 120 个字")
    if clean_style not in GIFT_WRAP_STYLES:
        raise HTTPException(status_code=422, detail="不认识这种包装纸")
    if len(files) > 6:
        raise HTTPException(status_code=422, detail="一份礼物最多放 6 张照片")

    pair = get_pair_for_user(db, current_user.id)
    receiver = counterpart(pair, current_user)
    created_at = utc_now()
    event_date = meeting_date_for_values(occurred_at, created_at)
    meeting = find_meeting_for_date(db, pair.id, event_date)
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting.id if meeting else None,
        title=clean_title,
        description=clean_message or None,
        occurred_at=occurred_at or created_at,
        event_kind=EventKind.gift,
        gift_receiver_id=receiver.id,
        gift_wrap_style=clean_style,
        gift_teaser=clean_teaser or None,
        gift_open_at=_utc(open_at),
        gift_feelings=[],
        visibility_mode=VisibilityMode.public,
        created_at=created_at,
    )
    written_keys: list[str] = []
    with discard_media_on_error(db, written_keys):
        db.add(event)
        db.flush()
        for image_order, upload in enumerate(files):
            stored = save_uploaded_image(upload, lambda mime: build_image_storage_keys(pair.id, event.id, mime))
            written_keys.extend(stored.keys)
            db.add(
                Image(
                    event_id=event.id,
                    author_id=current_user.id,
                    sort_order=image_order,
                    file_path="",
                    storage_key=stored.storage_key,
                    thumb_storage_key=stored.thumb_storage_key,
                    storage_backend=get_settings().media_storage,
                    data=None,
                    thumb_data=None,
                    thumb_mime_type="image/jpeg",
                    thumb_size_bytes=stored.thumb_size_bytes,
                    mime_type=stored.mime_type,
                    size_bytes=stored.size_bytes,
                )
            )
        db.commit()

    db.refresh(event)
    detail = event_detail(db, event, current_user, pair)
    background.add_task(
        notify_gift_wrapped,
        recipient_email=receiver.email,
        recipient_name=receiver.display_name,
        recipient_token=active_token_for_user(db, receiver.id),
        actor_name=current_user.display_name,
        event_id=event.id,
    )
    return detail


@router.post("/{event_id}/gift/open", response_model=EventDetail)
def open_gift(
    event_id: int,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = _ensure_pair_gift(db, event_id, pair)
    _ensure_gift_receiver(event, current_user)
    if not gift_is_wrapped(event):
        return event_detail(db, event, current_user, pair)
    if not gift_open_time_reached(event):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=GIFT_NOT_YET_DETAIL)
    event.gift_opened_at = utc_now()
    db.flush()
    db.commit()
    db.refresh(event)
    sender = db.get(User, event.creator_id)
    if sender is not None:
        background.add_task(
            notify_gift_opened,
            recipient_email=sender.email,
            recipient_name=sender.display_name,
            recipient_token=active_token_for_user(db, sender.id),
            actor_name=current_user.display_name,
            event_id=event.id,
        )
    return event_detail(db, event, current_user, pair)


@router.put("/{event_id}/gift/response", response_model=EventDetail)
def respond_gift(
    event_id: int,
    payload: GiftResponseIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = _ensure_pair_gift(db, event_id, pair)
    _ensure_gift_receiver(event, current_user)
    if gift_is_wrapped(event):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="先拆开礼物再写感受吧")
    feedback = payload.feedback.strip()
    event.gift_feelings = [feeling.value for feeling in payload.feelings]
    event.gift_rating = payload.rating
    event.gift_feedback = feedback or None
    event.gift_responded_at = utc_now()
    db.flush()
    db.commit()
    db.refresh(event)
    return event_detail(db, event, current_user, pair)


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


def _apply_wrapped_gift_rules(event: Event, updates: dict) -> None:
    if "event_kind" in updates and updates["event_kind"] not in {EventKind.gift, EventKind.offline_meeting}:
        raise HTTPException(status_code=422, detail="礼物不能改成别的类型")
    if "gift_rating" in updates or "gift_feelings" in updates:
        raise HTTPException(status_code=422, detail="收礼感受请由收礼的人填写")
    if not gift_is_wrapped(event) and GIFT_CONTENT_FIELDS & set(updates):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=GIFT_OPENED_EDIT_DETAIL)
    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()
        if not updates["title"]:
            raise HTTPException(status_code=422, detail="礼物名称不能为空")
    if "title" in updates and updates["title"] is None:
        updates.pop("title")
    if "description" in updates:
        description = (updates["description"] or "").strip()
        if len(description) > 2000:
            raise HTTPException(status_code=422, detail="想说的话最多 2000 个字")
        updates["description"] = description or None
    if "gift_wrap_style" in updates and updates["gift_wrap_style"] is None:
        updates["gift_wrap_style"] = DEFAULT_GIFT_WRAP_STYLE
    if "gift_open_at" in updates:
        updates["gift_open_at"] = _utc(updates["gift_open_at"])
    updates.pop("visibility_mode", None)


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

    wrapped_kind = event.event_kind == EventKind.gift
    if wrapped_kind:
        _apply_wrapped_gift_rules(event, updates)
    else:
        if GIFT_ONLY_FIELDS & set(updates):
            raise HTTPException(status_code=422, detail="只有礼物可以设置包装和拆开时间")
        if updates.get("event_kind") == EventKind.gift:
            raise HTTPException(status_code=422, detail="送礼物请使用包礼物入口")

    kept_kind = event.event_kind if event.event_kind in GIFT_EVENT_KINDS else None
    if updates.get("event_kind") == EventKind.gift_received:
        kept_kind = EventKind.gift_received
    is_gift = kept_kind is not None
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
            updates["event_kind"] = kept_kind or EventKind.offline_meeting

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
        meeting_title = updates.get("title", event.title)
        if wrapped_kind and gift_is_wrapped(event):
            meeting_title = "一份礼物"
        meeting_session = get_or_create_single_day_meeting(
            db,
            pair,
            current_user,
            meeting_title,
            event_date,
        )
    if meeting_session is not None:
        updates["event_kind"] = kept_kind or EventKind.offline_meeting
        updates["meeting_session_id"] = meeting_session.id
    else:
        updates["event_kind"] = kept_kind or EventKind.memory
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
