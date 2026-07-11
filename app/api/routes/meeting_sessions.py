"""Meeting route handlers for shared titles, event-derived time ranges, and atomic batch assignment of existing records."""

from datetime import datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import Event, EventKind, MeetingSession, User
from app.schemas import MeetingSessionCreate, MeetingSessionEventsAssign, MeetingSessionOut, MeetingSessionUpdate
from app.services import delete_meeting_if_empty, ensure_pair_event, ensure_pair_meeting_session, meeting_session_time_range

router = APIRouter(prefix="/meeting-sessions", tags=["meeting-sessions"])


def _meeting_session_out(db: Session, meeting_session: MeetingSession) -> MeetingSessionOut:
    event_count = db.scalar(select(func.count(Event.id)).where(Event.meeting_session_id == meeting_session.id)) or 0
    started_at, ended_at = meeting_session_time_range(db, meeting_session.id)
    return MeetingSessionOut.model_validate(meeting_session).model_copy(
        update={"event_count": event_count, "started_at": started_at, "ended_at": ended_at}
    )


def _meeting_session_sort_time(db: Session, meeting_session: MeetingSession) -> datetime:
    started_at, _ = meeting_session_time_range(db, meeting_session.id)
    return started_at or meeting_session.created_at


@router.get("", response_model=list[MeetingSessionOut])
def list_meeting_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MeetingSessionOut]:
    pair = get_pair_for_user(db, current_user.id)
    sessions = db.execute(select(MeetingSession).where(MeetingSession.pair_id == pair.id)).scalars().all()
    sessions.sort(
        key=lambda item: (_meeting_session_sort_time(db, item), item.created_at, item.id),
        reverse=True,
    )
    return [_meeting_session_out(db, meeting_session) for meeting_session in sessions]


@router.post("", response_model=MeetingSessionOut, status_code=status.HTTP_201_CREATED)
def create_meeting_session(
    payload: MeetingSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingSessionOut:
    pair = get_pair_for_user(db, current_user.id)
    meeting_session = MeetingSession(
        pair_id=pair.id,
        title=payload.title,
        created_by_id=current_user.id,
    )
    db.add(meeting_session)
    db.commit()
    db.refresh(meeting_session)
    return _meeting_session_out(db, meeting_session)


@router.patch("/{session_id}", response_model=MeetingSessionOut)
def update_meeting_session(
    session_id: int,
    payload: MeetingSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingSessionOut:
    pair = get_pair_for_user(db, current_user.id)
    meeting_session = ensure_pair_meeting_session(db, session_id, pair)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(meeting_session, field, value)
    db.commit()
    db.refresh(meeting_session)
    return _meeting_session_out(db, meeting_session)


@router.post("/{session_id}/events", response_model=MeetingSessionOut)
def assign_events_to_meeting_session(
    session_id: int,
    payload: MeetingSessionEventsAssign,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingSessionOut:
    pair = get_pair_for_user(db, current_user.id)
    meeting_session = ensure_pair_meeting_session(db, session_id, pair)
    events = [ensure_pair_event(db, event_id, pair) for event_id in payload.event_ids]
    previous_session_ids = {
        event.meeting_session_id
        for event in events
        if event.meeting_session_id is not None and event.meeting_session_id != meeting_session.id
    }
    for event in events:
        event.meeting_session_id = meeting_session.id
        event.event_kind = EventKind.offline_meeting
    db.flush()
    for previous_session_id in previous_session_ids:
        delete_meeting_if_empty(db, previous_session_id)
    db.commit()
    db.refresh(meeting_session)
    return _meeting_session_out(db, meeting_session)
