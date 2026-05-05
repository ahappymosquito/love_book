from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.models import Event, User
from app.schemas import EventCreate, EventDetail, EventSummary, EventUpdate
from app.services import ensure_pair_event, event_detail, event_summary

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        title=payload.title,
        description=payload.description,
        occurred_at=payload.occurred_at,
        visibility_mode=payload.visibility_mode,
    )
    db.add(event)
    db.flush()
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


@router.patch("/{event_id}", response_model=EventDetail)
def update_event(
    event_id: int,
    payload: EventUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EventDetail:
    pair = get_pair_for_user(db, current_user.id)
    event = ensure_pair_event(db, event_id, pair)
    if event.creator_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator can update this event")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.flush()
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
    db.delete(event)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
