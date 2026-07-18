"""Event routes for CRUD, meeting classification, notifications, and safe detachment of love-receipt memory links.

Mutation endpoints commit before returning so the frontend can immediately reload the new or changed event.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import delete_legacy_voice_rows, get_db
from app.emailer import notify_event_created
from app.models import Event, EventKind, LoveReceipt, User, utc_now
from app.schemas import EventCreate, EventDetail, EventSummary, EventUpdate
from app.services import active_token_for_user, counterpart, ensure_pair_event, ensure_pair_meeting_session, event_detail, event_summary, find_meeting_for_date, get_or_create_single_day_meeting, meeting_date_for_values

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
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
    event_kind = EventKind.offline_meeting if meeting_session is not None else EventKind.memory
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting_session_id,
        title=payload.title,
        description=payload.description,
        occurred_at=payload.occurred_at,
        event_kind=event_kind,
        visibility_mode=payload.visibility_mode,
        created_at=created_at,
    )
    db.add(event)
    db.flush()
    db.refresh(event)
    other = counterpart(pair, current_user)
    recipient_token = active_token_for_user(db, other.id)
    db.commit()
    db.refresh(event)
    detail = event_detail(db, event, current_user, pair)
    background.add_task(
        notify_event_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=recipient_token,
        actor_name=current_user.display_name,
        event_id=event.id,
        event_title=event.title,
        event_description=event.description,
        content_unlocked=detail.submission_state.unlocked,
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

    if "meeting_session_id" in updates:
        if updates["meeting_session_id"] is not None:
            ensure_pair_meeting_session(db, updates["meeting_session_id"], pair)
            updates["event_kind"] = EventKind.offline_meeting

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
        updates["event_kind"] = EventKind.offline_meeting
        updates["meeting_session_id"] = meeting_session.id
    else:
        updates["event_kind"] = EventKind.memory
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
