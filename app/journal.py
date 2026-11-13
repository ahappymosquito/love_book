"""Pair journal (手账) export: scope selection, Asia/Shanghai month grouping, and spoiler-safe masking.

Locked mutual_submit events and still-wrapped gifts are masked for every viewer (including a gift's sender) so an
exported journal can never reveal content early. Images are returned as ids only; pixels come from the authed
`/images/{id}/thumb` and `/images/{id}/file` endpoints.
"""

from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import GIFT_EVENT_KINDS, Event, MeetingSession, Pair, User, VisibilityMode, utc_now
from app.schemas import (
    JournalCommentOut,
    JournalEntryOut,
    JournalGiftOut,
    JournalImageOut,
    JournalMeetingOut,
    JournalMonthOut,
    JournalOut,
    JournalPairOut,
    JournalStatsOut,
    JournalUserOut,
)
from app.services import (
    CHINA_TZ,
    as_utc,
    counterpart,
    days_together,
    ensure_pair_meeting_session,
    gift_feedback,
    gift_is_wrapped,
    gift_receiver_id,
    gift_sender_id,
    gift_state,
    local_today,
    meeting_date_for_event,
    pair_love_started_on,
)

JOURNAL_MAX_ENTRIES = 2000
JOURNAL_TOO_LARGE_DETAIL = "范围太大，请缩小日期范围"
LOCKED_TITLE = "还没解锁的小事"
WRAPPED_GIFT_TITLE = "一份还没拆的礼物"


def _event_time(event: Event) -> datetime:
    return as_utc(event.occurred_at or event.created_at)  # type: ignore[return-value]


def _unlocked(event: Event, pair: Pair) -> bool:
    if event.visibility_mode == VisibilityMode.public:
        return True
    submitters = {comment.author_id for comment in event.comments} | {image.author_id for image in event.images}
    return pair.user_a_id in submitters and pair.user_b_id in submitters


def _gift_out(event: Event, pair: Pair) -> JournalGiftOut | None:
    state = gift_state(event)
    if state is None:
        return None
    wrapped = gift_is_wrapped(event)
    return JournalGiftOut(
        state=state,
        sender_id=gift_sender_id(event, pair),
        receiver_id=gift_receiver_id(event),
        wrap_style=event.gift_wrap_style,
        teaser=event.gift_teaser,
        opened_at=event.gift_opened_at,
        feelings=[] if wrapped else (event.gift_feelings or []),
        rating=None if wrapped else event.gift_rating,
        feedback=None if wrapped else gift_feedback(event),
    )


def _entry_out(event: Event, pair: Pair) -> JournalEntryOut:
    entry = JournalEntryOut(
        id=event.id,
        kind=event.event_kind,
        title=event.title,
        description=event.description,
        occurred_at=_event_time(event),
        creator_id=event.creator_id,
        meeting_session_id=event.meeting_session_id,
        meeting_title=event.meeting_session.title if event.meeting_session else None,
        gift=_gift_out(event, pair),
    )
    if gift_is_wrapped(event):
        entry.title = WRAPPED_GIFT_TITLE
        entry.description = None
        return entry
    if not _unlocked(event, pair):
        entry.locked = True
        entry.title = LOCKED_TITLE
        entry.description = None
        return entry
    images = sorted(event.images, key=lambda image: (image.sort_order, as_utc(image.created_at), image.id))
    comments = sorted(event.comments, key=lambda comment: (as_utc(comment.created_at), comment.id))
    entry.images = [JournalImageOut(id=image.id, width=image.width, height=image.height) for image in images]
    entry.comments = [
        JournalCommentOut(id=comment.id, author_id=comment.author_id, content=comment.text, created_at=comment.created_at)
        for comment in comments
    ]
    return entry


def _user_out(user: User) -> JournalUserOut:
    return JournalUserOut(
        id=user.id,
        display_name=user.display_name,
        avatar=user.avatar or "",
        avatar_has_image=user.avatar_has_image,
        avatar_updated_at=user.avatar_updated_at,
    )


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    lower = datetime.combine(start, time.min, tzinfo=CHINA_TZ) - timedelta(days=1)
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=CHINA_TZ) + timedelta(days=1)
    return as_utc(lower), as_utc(upper)  # type: ignore[return-value]


def build_journal(
    db: Session,
    pair: Pair,
    user: User,
    *,
    scope: str,
    start: date | None,
    end: date | None,
    meeting_id: int | None,
) -> JournalOut:
    conditions = [Event.pair_id == pair.id]
    meeting: MeetingSession | None = None
    if scope == "range":
        if start is None or end is None:
            raise HTTPException(status_code=422, detail="请选择开始和结束日期")
        if start > end:
            raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
        lower, upper = _day_bounds(start, end)
        event_time = func.coalesce(Event.occurred_at, Event.created_at)
        conditions += [event_time >= lower, event_time < upper]
    elif scope == "meeting":
        if meeting_id is None:
            raise HTTPException(status_code=422, detail="请选择一次见面")
        meeting = ensure_pair_meeting_session(db, meeting_id, pair)
        conditions.append(Event.meeting_session_id == meeting.id)

    total = int(db.scalar(select(func.count(Event.id)).where(*conditions)) or 0)
    if total > JOURNAL_MAX_ENTRIES * 2:
        raise HTTPException(status_code=422, detail=JOURNAL_TOO_LARGE_DETAIL)

    events = (
        db.execute(
            select(Event)
            .where(*conditions)
            .options(selectinload(Event.images), selectinload(Event.comments), selectinload(Event.meeting_session))
        )
        .scalars()
        .all()
    )
    if scope == "range":
        events = [event for event in events if start <= meeting_date_for_event(event) <= end]  # type: ignore[operator]
    if len(events) > JOURNAL_MAX_ENTRIES:
        raise HTTPException(status_code=422, detail=JOURNAL_TOO_LARGE_DETAIL)
    events.sort(key=lambda event: (_event_time(event), event.id))

    months: list[JournalMonthOut] = []
    for event in events:
        local = _event_time(event).astimezone(CHINA_TZ)
        month_key = f"{local.year:04d}-{local.month:02d}"
        if not months or months[-1].month != month_key:
            months.append(JournalMonthOut(month=month_key, label=f"{local.year}年{local.month}月", entries=[]))
        months[-1].entries.append(_entry_out(event, pair))
    entries = [entry for month in months for entry in month.entries]

    meeting_query = select(MeetingSession).where(MeetingSession.pair_id == pair.id)
    if scope == "meeting" and meeting is not None:
        meeting_query = meeting_query.where(MeetingSession.id == meeting.id)
    elif scope == "range":
        meeting_query = meeting_query.where(MeetingSession.started_on <= end, MeetingSession.ended_on >= start)
    meetings = db.execute(meeting_query.order_by(MeetingSession.started_on, MeetingSession.id)).scalars().all()

    if scope == "meeting" and meeting is not None:
        title, out_start, out_end = meeting.title, meeting.started_on, meeting.ended_on
    elif scope == "range":
        title, out_start, out_end = f"{start:%Y.%m.%d} - {end:%Y.%m.%d}", start, end
    else:
        event_dates = [meeting_date_for_event(event) for event in events]
        title = "我们的手账"
        out_start = min(event_dates) if event_dates else None
        out_end = max(event_dates) if event_dates else None

    together_since = pair_love_started_on(pair)
    return JournalOut(
        scope=scope,  # type: ignore[arg-type]
        title=title,
        start=out_start,
        end=out_end,
        generated_at=utc_now(),
        pair=JournalPairOut(
            users=[_user_out(user), _user_out(counterpart(pair, user))],
            together_since=together_since,
            together_days=days_together(together_since, local_today()),
        ),
        meetings=[
            JournalMeetingOut(id=item.id, title=item.title, started_on=item.started_on, ended_on=item.ended_on)
            for item in meetings
        ],
        months=months,
        stats=JournalStatsOut(
            entry_count=len(entries),
            image_count=sum(len(entry.images) for entry in entries),
            gift_count=sum(1 for event in events if event.event_kind in GIFT_EVENT_KINDS),
            meeting_count=len(meetings),
        ),
    )
