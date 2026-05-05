from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import Select, exists, or_, select
from sqlalchemy.orm import Session

from app.models import Comment, Event, Pair, User, VisibilityMode, Voice
from app.schemas import (
    CommentOut,
    ContentsOut,
    EventDetail,
    EventSummary,
    SubmissionState,
    VoiceOut,
)


def counterpart(pair: Pair, user: User) -> User:
    if pair.user_a_id == user.id:
        return pair.user_b
    if pair.user_b_id == user.id:
        return pair.user_a
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in pair")


def ensure_pair_event(db: Session, event_id: int, pair: Pair) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.pair_id != pair.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def user_has_submitted_query(event_id: int, user_id: int) -> Select[tuple[bool]]:
    comment_exists = exists().where(Comment.event_id == event_id, Comment.author_id == user_id)
    voice_exists = exists().where(Voice.event_id == event_id, Voice.author_id == user_id)
    return select(or_(comment_exists, voice_exists))


def user_has_submitted(db: Session, event_id: int, user_id: int) -> bool:
    return bool(db.execute(user_has_submitted_query(event_id, user_id)).scalar())


def submission_state(db: Session, event: Event, user: User, pair: Pair) -> SubmissionState:
    other = counterpart(pair, user)
    current_submitted = user_has_submitted(db, event.id, user.id)
    other_submitted = user_has_submitted(db, event.id, other.id)
    unlocked = event.visibility_mode == VisibilityMode.public or (current_submitted and other_submitted)
    return SubmissionState(
        current_user_submitted=current_submitted,
        counterpart_submitted=other_submitted,
        unlocked=unlocked,
    )


def visible_contents(db: Session, event: Event, user: User, pair: Pair) -> ContentsOut:
    state = submission_state(db, event, user, pair)
    comments_query = select(Comment).where(Comment.event_id == event.id)
    voices_query = select(Voice).where(Voice.event_id == event.id)

    if not state.unlocked:
        comments_query = comments_query.where(Comment.author_id == user.id)
        voices_query = voices_query.where(Voice.author_id == user.id)

    comments = db.execute(comments_query.order_by(Comment.created_at, Comment.id)).scalars().all()
    voices = db.execute(voices_query.order_by(Voice.created_at, Voice.id)).scalars().all()
    return ContentsOut(
        submission_state=state,
        comments=[CommentOut.model_validate(comment) for comment in comments],
        voices=[VoiceOut.model_validate(voice) for voice in voices],
    )


def event_summary(db: Session, event: Event, user: User, pair: Pair) -> EventSummary:
    return EventSummary(
        id=event.id,
        pair_id=event.pair_id,
        creator_id=event.creator_id,
        title=event.title,
        description=event.description,
        occurred_at=event.occurred_at,
        visibility_mode=event.visibility_mode,
        created_at=event.created_at,
        submission_state=submission_state(db, event, user, pair),
    )


def event_detail(db: Session, event: Event, user: User, pair: Pair) -> EventDetail:
    summary = event_summary(db, event, user, pair)
    return EventDetail(**summary.model_dump(), contents=visible_contents(db, event, user, pair))


def ensure_voice_file_visible(db: Session, voice_id: int, user: User, pair: Pair) -> Voice:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found")
    event = ensure_pair_event(db, voice.event_id, pair)
    contents = visible_contents(db, event, user, pair)
    if all(item.id != voice.id for item in contents.voices):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Voice is not visible yet")
    if not Path(voice.file_path).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")
    return voice
