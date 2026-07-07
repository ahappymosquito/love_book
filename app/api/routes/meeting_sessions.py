"""Meeting session route handlers for manually named offline-meeting clusters shared by each pair."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import Event, MeetingSession, User
from app.schemas import MeetingSessionCreate, MeetingSessionOut, MeetingSessionUpdate
from app.services import ensure_pair_meeting_session

router = APIRouter(prefix="/meeting-sessions", tags=["meeting-sessions"])


def _validate_date_range(started_on, ended_on) -> None:
    if started_on is not None and ended_on is not None and ended_on < started_on:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ended_on cannot be before started_on")


def _meeting_session_out(db: Session, meeting_session: MeetingSession) -> MeetingSessionOut:
    event_count = db.scalar(select(func.count(Event.id)).where(Event.meeting_session_id == meeting_session.id)) or 0
    return MeetingSessionOut.model_validate(meeting_session).model_copy(update={"event_count": event_count})


@router.get("", response_model=list[MeetingSessionOut])
def list_meeting_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MeetingSessionOut]:
    pair = get_pair_for_user(db, current_user.id)
    sessions = db.execute(select(MeetingSession).where(MeetingSession.pair_id == pair.id)).scalars().all()
    sessions.sort(
        key=lambda item: (
            item.started_on is not None,
            item.started_on or item.created_at.date(),
            item.created_at,
            item.id,
        ),
        reverse=True,
    )
    return [_meeting_session_out(db, meeting_session) for meeting_session in sessions]


@router.post("", response_model=MeetingSessionOut, status_code=status.HTTP_201_CREATED)
def create_meeting_session(
    payload: MeetingSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingSessionOut:
    _validate_date_range(payload.started_on, payload.ended_on)
    pair = get_pair_for_user(db, current_user.id)
    meeting_session = MeetingSession(
        pair_id=pair.id,
        title=payload.title,
        started_on=payload.started_on,
        ended_on=payload.ended_on,
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
    next_started_on = updates.get("started_on", meeting_session.started_on)
    next_ended_on = updates.get("ended_on", meeting_session.ended_on)
    _validate_date_range(next_started_on, next_ended_on)
    for field, value in updates.items():
        setattr(meeting_session, field, value)
    db.commit()
    db.refresh(meeting_session)
    return _meeting_session_out(db, meeting_session)
