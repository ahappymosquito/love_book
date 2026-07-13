"""Meeting route handlers for shared editable date ranges, overlap merging, automatic event classification, and cancellation."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import Event, MeetingSession, User
from app.schemas import MeetingSessionCreate, MeetingSessionOut, MeetingSessionUpdate
from app.services import ensure_pair_meeting_session, meeting_creation_key, meeting_ranges_overlap, meeting_session_time_range, reconcile_pair_meeting_ranges

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
    if payload.started_on > payload.ended_on:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Meeting start date must not be after end date")
    meeting_session = MeetingSession(
        pair_id=pair.id,
        title=payload.title,
        started_on=payload.started_on,
        ended_on=payload.ended_on,
        created_by_id=current_user.id,
    )
    db.add(meeting_session)
    db.flush()
    candidates = db.execute(select(MeetingSession).where(MeetingSession.pair_id == pair.id)).scalars().all()
    overlapping = [candidate for candidate in candidates if meeting_ranges_overlap(candidate, meeting_session)]
    canonical_id = min(overlapping, key=meeting_creation_key).id
    reconcile_pair_meeting_ranges(db, pair.id)
    db.commit()
    canonical = db.get(MeetingSession, canonical_id)
    if canonical is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Meeting merge failed")
    return _meeting_session_out(db, canonical)


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
    if next_started_on is None or next_ended_on is None or next_started_on > next_ended_on:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Meeting date range is invalid")
    for field, value in updates.items():
        setattr(meeting_session, field, value)
    db.flush()
    candidates = db.execute(select(MeetingSession).where(MeetingSession.pair_id == pair.id)).scalars().all()
    overlapping = [candidate for candidate in candidates if meeting_ranges_overlap(candidate, meeting_session)]
    canonical_id = min(overlapping, key=meeting_creation_key).id
    reconcile_pair_meeting_ranges(db, pair.id)
    db.commit()
    canonical = db.get(MeetingSession, canonical_id)
    if canonical is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Meeting merge failed")
    return _meeting_session_out(db, canonical)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    meeting_session = ensure_pair_meeting_session(db, session_id, pair)
    db.delete(meeting_session)
    db.flush()
    reconcile_pair_meeting_ranges(db, pair.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
