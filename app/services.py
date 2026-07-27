"""Shared pair, meeting, event, comment, image, quote, visibility, and home-reminder business logic."""

import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import HTTPException, status
from sqlalchemy import Select, exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import Comment, CommentReaction, DefaultQuote, DeviceToken, Event, EventKind, Image, MeetingSession, Pair, Quote, User, VisibilityMode, utc_now
from app.schemas import (
    AnniversaryOut,
    CommentOut,
    CommentReactionSummary,
    ContentsOut,
    EventDetail,
    EventSummary,
    ImageOut,
    MeetingSessionLite,
    ReminderItem,
    SubmissionState,
)
from app.storage import media_file_exists

COMMENT_REACTION_TYPES = ("like", "dislike")
CHINA_TZ = timezone(timedelta(hours=8))
MEETING_TZ = CHINA_TZ
HOLIDAY_INFO_URL = "https://timor.tech/api/holiday/info/{date}"
DEFAULT_LOVE_QUOTES = [
    "我说伤心了怎么办 小狗说忘忘忘忘忘忘",
    "见人说人话，见鬼说鬼话，见你说黄话",
    "你不用变得多厉害，只要每天开开心心，乖乖听话，我就很满足了",
    "小狗（直男）哭泣是非基悲",
    "小狗爱我如养花什么屎尿都往我嘴里",
    "日行一善积大德，日行两善积积大大德",
    "日行一恶必失德，日行两恶比比失失德",
    "如果碰不到你的双唇，你的笑容就是我的吻痕",
]
LOVE_FESTIVALS: dict[tuple[int, int], tuple[str, str]] = {
    (2, 14): ("情人节", "今天适合认真说爱，也适合一起把普通日子过甜。"),
    (3, 14): ("白色情人节", "把收到的喜欢再送回去一点，刚好装满今天。"),
    (5, 20): ("520 网络情人节", "520 到了，今天的喜欢要明目张胆一点。"),
    (5, 21): ("521 告白日", "今天也很适合告白，哪怕只是再说一次我喜欢你。"),
    (12, 25): ("圣诞约会日", "今天适合牵手、散步，也适合把愿望说给彼此听。"),
}


def local_today() -> date:
    return utc_now().astimezone(CHINA_TZ).date()


def pair_love_started_on(pair: Pair) -> date:
    if pair.love_started_on is not None:
        return pair.love_started_on
    created_at = pair.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=CHINA_TZ)
    return created_at.astimezone(CHINA_TZ).date()


def days_together(started_on: date, today: date) -> int:
    return max(1, (today - started_on).days + 1)


def anniversary_items(started_on: date, today: date) -> list[ReminderItem]:
    days = days_together(started_on, today)
    items: list[ReminderItem] = []
    if days == 520:
        items.append(
            ReminderItem(type="anniversary", label="520 天", message="一起走到第 520 天，今天要把爱说得更大声。")
        )
    if days == 1314:
        items.append(
            ReminderItem(type="anniversary", label="1314 天", message="第 1314 天，像一句长长久久的承诺。")
        )

    month_delta = (today.year - started_on.year) * 12 + today.month - started_on.month
    if month_delta > 0 and today.day == started_on.day:
        items.append(
            ReminderItem(
                type="anniversary",
                label=f"{month_delta} 个月",
                message=f"今天是你们在一起满 {month_delta} 个月的日子。",
            )
        )
    return items


def love_festival_items(today: date, holiday_name: str | None = None) -> list[ReminderItem]:
    items: list[ReminderItem] = []
    festival = LOVE_FESTIVALS.get((today.month, today.day))
    if festival:
        label, message = festival
        items.append(ReminderItem(type="love_festival", label=label, message=message))
    if holiday_name and "七夕" in holiday_name:
        items.append(
            ReminderItem(type="love_festival", label="七夕", message="七夕到了，今天的星河也偏向你们。")
        )
    return items


def fetch_holiday_item(today: date) -> tuple[list[ReminderItem], str | None]:
    try:
        response = httpx.get(HOLIDAY_INFO_URL.format(date=today.isoformat()), timeout=2.0)
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return [], None

    holiday = payload.get("holiday") if isinstance(payload, dict) else None
    if not isinstance(holiday, dict):
        return [], None

    name = str(holiday.get("name") or "").strip() or None
    is_holiday = bool(holiday.get("holiday"))
    is_after = bool(holiday.get("after"))
    wage = holiday.get("wage")
    items: list[ReminderItem] = []

    if is_holiday:
        label = name or "放假日"
        items.append(ReminderItem(type="holiday", label=label, message=f"今天是{label}，适合把时间留给彼此。"))
    elif is_after or wage == 1:
        label = name or "调休补班"
        items.append(ReminderItem(type="workday", label=label, message=f"今天是{label}，忙完也要记得抱抱。"))

    return items, name


def ensure_default_quotes(db: Session) -> None:
    existing_texts = set(db.execute(select(DefaultQuote.text)).scalars().all())
    missing = [text for text in DEFAULT_LOVE_QUOTES if text not in existing_texts]
    if not missing:
        return
    db.add_all(DefaultQuote(text=text) for text in missing)
    db.flush()


def local_quote_for_pair(db: Session, pair: Pair) -> str:
    ensure_default_quotes(db)
    pair_quotes = db.execute(select(Quote.text).where(Quote.pair_id == pair.id)).scalars().all()
    default_quotes = db.execute(select(DefaultQuote.text)).scalars().all()
    quote_pool = [*pair_quotes, *default_quotes]
    if quote_pool:
        return random.choice(quote_pool)
    return random.choice(DEFAULT_LOVE_QUOTES)


def build_anniversary(db: Session, pair: Pair) -> AnniversaryOut:
    today = local_today()
    started_on = pair_love_started_on(pair)
    holiday_items, holiday_name = fetch_holiday_item(today)
    ann_items = anniversary_items(started_on, today)
    festival_items = love_festival_items(today, holiday_name)

    if ann_items:
        message = " ".join(item.message or item.label for item in ann_items)
        source = "anniversary"
    elif festival_items:
        message = " ".join(item.message or item.label for item in festival_items)
        source = "love_festival"
    elif holiday_items:
        message = " ".join(item.message or item.label for item in holiday_items)
        source = "holiday"
    else:
        message = local_quote_for_pair(db, pair)
        source = "local"

    return AnniversaryOut(
        love_started_on=started_on,
        today=today,
        days_together=days_together(started_on, today),
        anniversary_items=ann_items,
        love_festival_items=festival_items,
        holiday_items=holiday_items,
        message=message,
        message_source=source,
    )


def counterpart(pair: Pair, user: User) -> User:
    if pair.user_a_id == user.id:
        return pair.user_b
    if pair.user_b_id == user.id:
        return pair.user_a
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in pair")


def active_token_for_user(db: Session, user_id: int) -> str | None:
    """返回该用户当前可用（未过期）的任意一条 token，没有则返回 None。"""
    now = utc_now()
    tokens = (
        db.execute(
            select(DeviceToken)
            .where(DeviceToken.user_id == user_id)
            .order_by(DeviceToken.created_at.desc())
        )
        .scalars()
        .all()
    )
    for token in tokens:
        expires_at = token.expires_at
        if expires_at is None:
            return token.token
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=now.tzinfo)
        if expires_at > now:
            return token.token
    return None


def ensure_pair_event(db: Session, event_id: int, pair: Pair) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.pair_id != pair.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


def ensure_pair_meeting_session(db: Session, session_id: int, pair: Pair) -> MeetingSession:
    meeting_session = db.get(MeetingSession, session_id)
    if meeting_session is None or meeting_session.pair_id != pair.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting session not found")
    return meeting_session


def meeting_date_for_values(occurred_at: datetime | None, created_at: datetime) -> date:
    event_time = occurred_at or created_at
    if event_time.tzinfo is None:
        event_time = event_time.replace(tzinfo=timezone.utc)
    return event_time.astimezone(MEETING_TZ).date()


def meeting_date_for_event(event: Event) -> date:
    return meeting_date_for_values(event.occurred_at, event.created_at)


def meeting_contains_date(meeting: MeetingSession, event_date: date) -> bool:
    return bool(
        meeting.started_on is not None
        and meeting.ended_on is not None
        and meeting.started_on <= event_date <= meeting.ended_on
    )


def find_meeting_for_date(db: Session, pair_id: int, event_date: date) -> MeetingSession | None:
    meetings = db.execute(
        select(MeetingSession)
        .where(
            MeetingSession.pair_id == pair_id,
            MeetingSession.started_on <= event_date,
            MeetingSession.ended_on >= event_date,
        )
        .order_by(MeetingSession.created_at, MeetingSession.id)
    ).scalars().all()
    return meetings[0] if meetings else None


def get_or_create_single_day_meeting(
    db: Session,
    pair: Pair,
    user: User,
    title: str,
    event_date: date,
) -> MeetingSession:
    db.execute(select(Pair.id).where(Pair.id == pair.id).with_for_update())
    meeting = find_meeting_for_date(db, pair.id, event_date)
    if meeting is not None:
        return meeting
    meeting = MeetingSession(
        pair_id=pair.id,
        title=title,
        started_on=event_date,
        ended_on=event_date,
        created_by_id=user.id,
    )
    db.add(meeting)
    db.flush()
    return meeting


def delete_meeting_if_empty(db: Session, meeting_session_id: int | None) -> None:
    if meeting_session_id is None:
        return
    event_count = db.scalar(select(func.count(Event.id)).where(Event.meeting_session_id == meeting_session_id)) or 0
    if event_count == 0:
        meeting = db.get(MeetingSession, meeting_session_id)
        if meeting is not None:
            db.delete(meeting)


def meeting_ranges_overlap(left: MeetingSession, right: MeetingSession) -> bool:
    if left.started_on is None or left.ended_on is None or right.started_on is None or right.ended_on is None:
        return False
    return left.started_on <= right.ended_on and right.started_on <= left.ended_on


def meeting_creation_key(meeting: MeetingSession) -> tuple[float, int]:
    created_at = meeting.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.timestamp(), meeting.id


def reconcile_pair_meeting_ranges(db: Session, pair_id: int) -> list[MeetingSession]:
    meetings = db.execute(
        select(MeetingSession)
        .where(
            MeetingSession.pair_id == pair_id,
            MeetingSession.started_on.is_not(None),
            MeetingSession.ended_on.is_not(None),
        )
        .order_by(MeetingSession.created_at, MeetingSession.id)
    ).scalars().all()

    remaining = list(meetings)
    canonical_meetings: list[MeetingSession] = []
    while remaining:
        component = [remaining.pop(0)]
        expanded = True
        while expanded:
            expanded = False
            for candidate in list(remaining):
                if any(meeting_ranges_overlap(candidate, member) for member in component):
                    component.append(candidate)
                    remaining.remove(candidate)
                    expanded = True
        canonical = min(component, key=meeting_creation_key)
        canonical.started_on = min(meeting.started_on for meeting in component if meeting.started_on is not None)
        canonical.ended_on = max(meeting.ended_on for meeting in component if meeting.ended_on is not None)
        for merged in component:
            if merged.id == canonical.id:
                continue
            db.execute(
                Event.__table__.update()
                .where(Event.meeting_session_id == merged.id)
                .values(meeting_session_id=canonical.id)
            )
            db.delete(merged)
        canonical_meetings.append(canonical)

    db.flush()
    events = db.execute(select(Event).where(Event.pair_id == pair_id)).scalars().all()
    canonical_meetings.sort(key=lambda meeting: (meeting.started_on or date.min, meeting_creation_key(meeting)))
    for event in events:
        event_date = meeting_date_for_event(event)
        matching = next(
            (meeting for meeting in canonical_meetings if meeting_contains_date(meeting, event_date)),
            None,
        )
        if matching is None:
            if event.event_kind == EventKind.offline_meeting:
                event.event_kind = EventKind.memory
            event.meeting_session_id = None
        else:
            if event.event_kind != EventKind.gift_received:
                event.event_kind = EventKind.offline_meeting
            event.meeting_session_id = matching.id
    db.flush()
    return canonical_meetings


def normalize_meeting_ranges(db: Session) -> None:
    meetings = db.execute(select(MeetingSession).order_by(MeetingSession.created_at, MeetingSession.id)).scalars().all()
    for meeting in meetings:
        assigned_events = db.execute(
            select(Event).where(Event.meeting_session_id == meeting.id).order_by(Event.created_at, Event.id)
        ).scalars().all()
        if meeting.started_on is None or meeting.ended_on is None:
            if not assigned_events:
                db.delete(meeting)
                continue
            event_dates = [meeting_date_for_event(event) for event in assigned_events]
            meeting.started_on = min(event_dates)
            meeting.ended_on = max(event_dates)
        elif meeting.started_on > meeting.ended_on:
            meeting.started_on, meeting.ended_on = meeting.ended_on, meeting.started_on
    db.flush()

    orphan_events = db.execute(
        select(Event)
        .where(Event.event_kind == EventKind.offline_meeting, Event.meeting_session_id.is_(None))
        .order_by(Event.created_at, Event.id)
    ).scalars().all()
    for event in orphan_events:
        event_date = meeting_date_for_event(event)
        meeting = find_meeting_for_date(db, event.pair_id, event_date)
        if meeting is None:
            meeting = MeetingSession(
                pair_id=event.pair_id,
                title=event.title,
                started_on=event_date,
                ended_on=event_date,
                created_by_id=event.creator_id,
                created_at=event.created_at,
                updated_at=event.created_at,
            )
            db.add(meeting)
            db.flush()
        event.meeting_session_id = meeting.id

    pair_ids = db.execute(select(MeetingSession.pair_id).distinct()).scalars().all()
    for pair_id in pair_ids:
        reconcile_pair_meeting_ranges(db, pair_id)


def meeting_session_time_range(db: Session, meeting_session_id: int) -> tuple[datetime | None, datetime | None]:
    event_time = func.coalesce(Event.occurred_at, Event.created_at)
    started_at, ended_at = db.execute(
        select(func.min(event_time), func.max(event_time)).where(Event.meeting_session_id == meeting_session_id)
    ).one()
    return started_at, ended_at


def meeting_session_lite(db: Session, meeting_session: MeetingSession) -> MeetingSessionLite:
    started_at, ended_at = meeting_session_time_range(db, meeting_session.id)
    return MeetingSessionLite(
        id=meeting_session.id,
        title=meeting_session.title,
        started_on=meeting_session.started_on,
        ended_on=meeting_session.ended_on,
        started_at=started_at,
        ended_at=ended_at,
    )


def comment_reaction_summaries(
    db: Session,
    comments: list[Comment],
    user_id: int,
) -> dict[int, list[CommentReactionSummary]]:
    comment_ids = [comment.id for comment in comments]
    if not comment_ids:
        return {}

    reactions = (
        db.execute(select(CommentReaction).where(CommentReaction.comment_id.in_(comment_ids)))
        .scalars()
        .all()
    )
    counts: dict[int, dict[str, int]] = {comment_id: {} for comment_id in comment_ids}
    mine: dict[int, set[str]] = {comment_id: set() for comment_id in comment_ids}
    for reaction in reactions:
        if reaction.reaction_type not in COMMENT_REACTION_TYPES:
            continue
        counts[reaction.comment_id][reaction.reaction_type] = (
            counts[reaction.comment_id].get(reaction.reaction_type, 0) + 1
        )
        if reaction.author_id == user_id:
            mine[reaction.comment_id].add(reaction.reaction_type)

    return {
        comment_id: [
            CommentReactionSummary(
                reaction_type=reaction_type,
                count=counts[comment_id][reaction_type],
                reacted_by_me=reaction_type in mine[comment_id],
            )
            for reaction_type in COMMENT_REACTION_TYPES
            if counts[comment_id].get(reaction_type, 0) > 0
        ]
        for comment_id in comment_ids
    }


def comment_outs(db: Session, comments: list[Comment], user_id: int) -> list[CommentOut]:
    reactions_by_comment = comment_reaction_summaries(db, comments, user_id)
    return [
        CommentOut(
            id=comment.id,
            event_id=comment.event_id,
            author_id=comment.author_id,
            text=comment.text,
            created_at=comment.created_at,
            reactions=reactions_by_comment.get(comment.id, []),
        )
        for comment in comments
    ]


def user_has_submitted_query(event_id: int, user_id: int) -> Select[tuple[bool]]:
    comment_exists = exists().where(Comment.event_id == event_id, Comment.author_id == user_id)
    image_exists = exists().where(Image.event_id == event_id, Image.author_id == user_id)
    return select(or_(comment_exists, image_exists))


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
    images_query = select(Image).where(Image.event_id == event.id)

    if not state.unlocked:
        comments_query = comments_query.where(Comment.author_id == user.id)
        images_query = images_query.where(Image.author_id == user.id)

    comments = db.execute(comments_query.order_by(Comment.created_at, Comment.id)).scalars().all()
    images = db.execute(images_query.order_by(Image.created_at, Image.id)).scalars().all()
    return ContentsOut(
        submission_state=state,
        comments=comment_outs(db, comments, user.id),
        images=[ImageOut.model_validate(image) for image in images],
    )


def event_summary(db: Session, event: Event, user: User, pair: Pair) -> EventSummary:
    return EventSummary(
        id=event.id,
        pair_id=event.pair_id,
        creator_id=event.creator_id,
        meeting_session_id=event.meeting_session_id,
        meeting_session=meeting_session_lite(db, event.meeting_session) if event.meeting_session else None,
        title=event.title,
        description=event.description,
        occurred_at=event.occurred_at,
        event_kind=event.event_kind,
        gift_rating=event.gift_rating,
        visibility_mode=event.visibility_mode,
        created_at=event.created_at,
        submission_state=submission_state(db, event, user, pair),
    )


def event_detail(db: Session, event: Event, user: User, pair: Pair) -> EventDetail:
    summary = event_summary(db, event, user, pair)
    return EventDetail(**summary.model_dump(), contents=visible_contents(db, event, user, pair))


def ensure_comment_visible(db: Session, comment_id: int, user: User, pair: Pair) -> Comment:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    event = ensure_pair_event(db, comment.event_id, pair)
    contents = visible_contents(db, event, user, pair)
    if all(item.id != comment.id for item in contents.comments):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Comment is not visible yet")
    return comment


def ensure_image_file_visible(db: Session, image_id: int, user: User, pair: Pair) -> Image:
    image = db.get(Image, image_id)
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    event = ensure_pair_event(db, image.event_id, pair)
    contents = visible_contents(db, event, user, pair)
    if all(item.id != image.id for item in contents.images):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Image is not visible yet")
    # Local storage keys are preferred, with old BLOB and file_path records kept readable.
    has_storage = bool(image.storage_key) and media_file_exists(image.storage_key or "")
    has_thumb_storage = bool(image.thumb_storage_key) and media_file_exists(image.thumb_storage_key or "")
    has_blob = bool(image.data) or bool(image.thumb_data)
    has_file = bool(image.file_path) and Path(image.file_path).exists()
    if not has_storage and not has_thumb_storage and not has_blob and not has_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")
    return image
