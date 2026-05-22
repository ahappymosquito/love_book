"""Shared business logic for pair access, content visibility, uploads, and home reminders."""

import random
from collections.abc import Callable
from datetime import date, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import HTTPException, status
from sqlalchemy import Select, exists, or_, select
from sqlalchemy.orm import Session

from app.models import Comment, DeviceToken, Event, Image, Pair, User, VisibilityMode, Voice, utc_now
from app.schemas import (
    AnniversaryOut,
    CommentOut,
    ContentsOut,
    EventDetail,
    EventSummary,
    ImageOut,
    ReminderItem,
    SubmissionState,
    VoiceOut,
)

CHINA_TZ = timezone(timedelta(hours=8))
HITOKOTO_URL = "https://v1.hitokoto.cn/?c=e&c=f&max_length=30&encode=json"
HOLIDAY_INFO_URL = "https://timor.tech/api/holiday/info/{date}"
LOCAL_LOVE_QUOTES = [
    "今天也想把温柔攒起来，慢慢都给你。",
    "日子往前走，我还是偏心你。",
    "和你一起的普通一天，也会发一点光。",
    "把晚风、星星和想念，都悄悄放进今天。",
    "喜欢不是一阵风，是每天醒来还想见你。",
]
QUOTE_CACHE_LIMIT = 3
QUOTE_CACHE: list[str] = []
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


def fetch_hitokoto_remote() -> str | None:
    try:
        response = httpx.get(HITOKOTO_URL, timeout=2.0)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            quote = str(payload.get("hitokoto") or "").strip()
            if quote:
                return quote
    except Exception:
        return None
    return None


def remember_quote(quote: str) -> None:
    quote = quote.strip()
    if not quote:
        return
    if quote in QUOTE_CACHE:
        QUOTE_CACHE.remove(quote)
    QUOTE_CACHE.insert(0, quote)
    del QUOTE_CACHE[QUOTE_CACHE_LIMIT:]


def refresh_hitokoto_cache() -> None:
    quote = fetch_hitokoto_remote()
    if quote:
        remember_quote(quote)


def cached_or_local_quote() -> tuple[str, str]:
    if QUOTE_CACHE:
        return QUOTE_CACHE[0], "hitokoto"
    return random.choice(LOCAL_LOVE_QUOTES), "local"


def build_anniversary(pair: Pair, schedule_quote_refresh: Callable[[Callable[[], None]], None] | None = None) -> AnniversaryOut:
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
        message, source = cached_or_local_quote()
        if schedule_quote_refresh is not None:
            schedule_quote_refresh(refresh_hitokoto_cache)

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


def user_has_submitted_query(event_id: int, user_id: int) -> Select[tuple[bool]]:
    comment_exists = exists().where(Comment.event_id == event_id, Comment.author_id == user_id)
    voice_exists = exists().where(Voice.event_id == event_id, Voice.author_id == user_id)
    image_exists = exists().where(Image.event_id == event_id, Image.author_id == user_id)
    return select(or_(comment_exists, voice_exists, image_exists))


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
    images_query = select(Image).where(Image.event_id == event.id)

    if not state.unlocked:
        comments_query = comments_query.where(Comment.author_id == user.id)
        voices_query = voices_query.where(Voice.author_id == user.id)
        images_query = images_query.where(Image.author_id == user.id)

    comments = db.execute(comments_query.order_by(Comment.created_at, Comment.id)).scalars().all()
    voices = db.execute(voices_query.order_by(Voice.created_at, Voice.id)).scalars().all()
    images = db.execute(images_query.order_by(Image.created_at, Image.id)).scalars().all()
    return ContentsOut(
        submission_state=state,
        comments=[CommentOut.model_validate(comment) for comment in comments],
        voices=[VoiceOut.model_validate(voice) for voice in voices],
        images=[ImageOut.model_validate(image) for image in images],
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


def ensure_image_file_visible(db: Session, image_id: int, user: User, pair: Pair) -> Image:
    image = db.get(Image, image_id)
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    event = ensure_pair_event(db, image.event_id, pair)
    contents = visible_contents(db, event, user, pair)
    if all(item.id != image.id for item in contents.images):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Image is not visible yet")
    # 内容存在性：BLOB 优先；老数据回退到磁盘路径
    has_blob = bool(image.data)
    has_file = bool(image.file_path) and Path(image.file_path).exists()
    if not has_blob and not has_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")
    return image
