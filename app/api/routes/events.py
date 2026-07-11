"""Event route handlers for creating, listing, updating, deleting, automatic meeting creation and cleanup, and notifying timeline events.

Mutation endpoints commit before returning so the frontend can immediately reload the new or changed event.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.emailer import notify_event_created
from app.models import Event, EventKind, User
from app.schemas import EventCreate, EventDetail, EventSummary, EventUpdate
from app.services import active_token_for_user, counterpart, create_meeting_for_event, delete_meeting_if_empty, ensure_pair_event, ensure_pair_meeting_session, event_detail, event_summary

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    meeting_session_id = payload.meeting_session_id
    if meeting_session_id is not None:
        ensure_pair_meeting_session(db, meeting_session_id, pair)
    elif payload.event_kind == EventKind.offline_meeting:
        meeting_session_id = create_meeting_for_event(db, pair, current_user, payload.title).id
    event_kind = EventKind.offline_meeting if meeting_session_id is not None else payload.event_kind
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting_session_id,
        title=payload.title,
        description=payload.description,
        occurred_at=payload.occurred_at,
        event_kind=event_kind,
        visibility_mode=payload.visibility_mode,
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
    previous_meeting_session_id = event.meeting_session_id
    updates = payload.model_dump(exclude_unset=True)
    classification_update_only = set(updates) <= {"meeting_session_id"}
    if event.creator_id != current_user.id and not classification_update_only:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator can update this event")

    if updates.get("event_kind") != EventKind.offline_meeting and updates.get("meeting_session_id") is not None:
        if "event_kind" in updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assigned meeting events must use the offline meeting kind",
            )

    if "meeting_session_id" in updates:
        if updates["meeting_session_id"] is not None:
            ensure_pair_meeting_session(db, updates["meeting_session_id"], pair)
            updates["event_kind"] = EventKind.offline_meeting
    else:
        next_kind = updates.get("event_kind", event.event_kind)
        if next_kind == EventKind.offline_meeting and event.meeting_session_id is None:
            meeting_title = updates.get("title", event.title)
            updates["meeting_session_id"] = create_meeting_for_event(db, pair, current_user, meeting_title).id
        elif next_kind != EventKind.offline_meeting:
            updates["meeting_session_id"] = None

    for field, value in updates.items():
        setattr(event, field, value)
    db.flush()
    if previous_meeting_session_id != event.meeting_session_id:
        delete_meeting_if_empty(db, previous_meeting_session_id)
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
    meeting_session_id = event.meeting_session_id
    db.delete(event)
    db.flush()
    delete_meeting_if_empty(db, meeting_session_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
