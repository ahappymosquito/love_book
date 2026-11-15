"""SQLAlchemy models for pair features, wrapped gifts (sender/receiver, wrap style, teaser, unwrap gate, receiver response), meeting plan todos, cycle mail reminders, private media, password sessions, and game scores.

Retired tables (todo_restaurants, todo_candidates, todo_schedules, ai_settings, users.location_*) stay in existing
databases untouched but no longer have models; see app.core.database for the legacy-row cleanup on todo delete.
"""

from datetime import date, datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.dialects.mysql import LONGBLOB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.schema import UniqueConstraint

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class VisibilityMode(StrEnum):
    public = "public"
    mutual_submit = "mutual_submit"


class EventKind(StrEnum):
    memory = "memory"
    offline_meeting = "offline_meeting"
    gift_received = "gift_received"
    gift = "gift"


GIFT_EVENT_KINDS = frozenset({EventKind.gift, EventKind.gift_received})
GIFT_WRAP_STYLES = ("rose", "peach", "sage", "cream", "starry")
DEFAULT_GIFT_WRAP_STYLE = "rose"


class GiftFeeling(StrEnum):
    happy = "happy"
    surprised = "surprised"
    touched = "touched"
    reassured = "reassured"
    cherished = "cherished"
    hug = "hug"
    disappointed = "disappointed"
    wronged = "wronged"
    pressured = "pressured"
    not_my_style = "not_my_style"
    upset = "upset"
    complicated = "complicated"


class LoveReceiptType(StrEnum):
    gift = "gift"
    takeout = "takeout"
    flower = "flower"
    drink = "drink"
    experience = "experience"
    custom = "custom"


class LoveReceiptStatus(StrEnum):
    created = "created"
    delivering = "delivering"
    delivered = "delivered"
    waiting_receipt = "waiting_receipt"
    completed = "completed"


class LoveReceiptImageKind(StrEnum):
    cover = "cover"
    receipt = "receipt"


class LoveReceiptMood(StrEnum):
    happy = "happy"
    surprised = "surprised"
    touched = "touched"
    reassured = "reassured"
    cherished = "cherished"
    hug = "hug"
    disappointed = "disappointed"
    wronged = "wronged"
    pressured = "pressured"
    not_my_style = "not_my_style"
    upset = "upset"
    complicated = "complicated"


class CyclePhase(StrEnum):
    menstrual = "menstrual"
    predicted_period = "predicted_period"
    follicular = "follicular"
    fertile = "fertile"
    ovulation = "ovulation"
    luteal = "luteal"
    unknown = "unknown"


class CycleFlow(StrEnum):
    none = "none"
    spotting = "spotting"
    light = "light"
    medium = "medium"
    heavy = "heavy"


class CycleMood(StrEnum):
    happy = "happy"
    calm = "calm"
    anxious = "anxious"
    sad = "sad"
    tired = "tired"


class TodoCategory(StrEnum):
    food = "food"
    play = "play"
    stay = "stay"
    prep = "prep"
    wish = "wish"


class CervicalMucus(StrEnum):
    none = "none"
    dry = "dry"
    moist = "moist"
    creamy = "creamy"
    eggwhite = "eggwhite"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    avatar_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255))
    login_name: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(500), nullable=True)
    password_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    @property
    def avatar_has_image(self) -> bool:
        return bool(self.avatar_storage_key)


class Pair(Base):
    __tablename__ = "pairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True)
    love_started_on: Mapped[date | None] = mapped_column(Date)
    dissolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dissolved_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    farewell_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user_a: Mapped[User] = relationship(foreign_keys=[user_a_id])
    user_b: Mapped[User] = relationship(foreign_keys=[user_b_id])


class DeviceToken(Base):
    __tablename__ = "device_tokens"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="entry", server_default="entry", index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship()


class GameScore(Base):
    """A public runner score; only the global top ten rows are retained."""

    __tablename__ = "game_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_name: Mapped[str] = mapped_column(String(12), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False, index=True
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    meeting_session_id: Mapped[int | None] = mapped_column(ForeignKey("meeting_sessions.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    event_kind: Mapped[EventKind] = mapped_column(
        Enum(EventKind), default=EventKind.memory, nullable=False, server_default=EventKind.memory.value, index=True
    )
    gift_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gift_feelings: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    gift_receiver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    gift_wrap_style: Mapped[str | None] = mapped_column(String(32), nullable=True)
    gift_teaser: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gift_open_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gift_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gift_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    gift_responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    visibility_mode: Mapped[VisibilityMode] = mapped_column(
        Enum(VisibilityMode), default=VisibilityMode.public, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    creator: Mapped[User] = relationship(foreign_keys=[creator_id])
    gift_receiver: Mapped[User | None] = relationship(foreign_keys=[gift_receiver_id])
    meeting_session: Mapped["MeetingSession | None"] = relationship(back_populates="events")
    comments: Mapped[list["Comment"]] = relationship(cascade="all, delete-orphan")
    images: Mapped[list["Image"]] = relationship(cascade="all, delete-orphan")


class MeetingSession(Base):
    __tablename__ = "meeting_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    started_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    ended_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    created_by: Mapped[User] = relationship()
    events: Mapped[list[Event]] = relationship(back_populates="meeting_session")


class LoveReceipt(Base):
    __tablename__ = "love_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    receipt_type: Mapped[LoveReceiptType] = mapped_column(Enum(LoveReceiptType), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[LoveReceiptStatus] = mapped_column(
        Enum(LoveReceiptStatus), default=LoveReceiptStatus.created, nullable=False, index=True
    )
    require_receipt: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="1")
    receipt_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    receipt_mood: Mapped[LoveReceiptMood | None] = mapped_column(Enum(LoveReceiptMood), nullable=True)
    receipt_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    timeline_event_id: Mapped[int | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    timeline_migrated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    sender: Mapped[User] = relationship(foreign_keys=[sender_id])
    receiver: Mapped[User] = relationship(foreign_keys=[receiver_id])
    timeline_event: Mapped[Event | None] = relationship()
    images: Mapped[list["LoveReceiptImage"]] = relationship(
        cascade="all, delete-orphan", back_populates="love_receipt"
    )


class LoveReceiptImage(Base):
    __tablename__ = "love_receipt_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    love_receipt_id: Mapped[int] = mapped_column(ForeignKey("love_receipts.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[LoveReceiptImageKind] = mapped_column(Enum(LoveReceiptImageKind), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    thumb_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(50), nullable=False, default="local", server_default="local")
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    thumb_mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="image/jpeg")
    thumb_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    love_receipt: Mapped[LoveReceipt] = relationship(back_populates="images")
    author: Mapped[User] = relationship()


class Quote(Base):
    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    author: Mapped[User] = relationship()


class DefaultQuote(Base):
    __tablename__ = "default_quotes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class TodoItem(Base):
    __tablename__ = "todo_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    category: Mapped[TodoCategory] = mapped_column(Enum(TodoCategory), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    # Plain integer references: cancelling a meeting or deleting a journal event must never be blocked by a plan item.
    meeting_session_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    journal_event_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    creator: Mapped[User] = relationship()
    comments: Mapped[list["TodoComment"]] = relationship(cascade="all, delete-orphan")
    images: Mapped[list["TodoImage"]] = relationship(cascade="all, delete-orphan")


class TodoComment(Base):
    __tablename__ = "todo_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("todo_items.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class TodoImage(Base):
    __tablename__ = "todo_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("todo_items.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thumb_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_backend: Mapped[str] = mapped_column(String(50), nullable=False, default="local", server_default="local")
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    thumb_mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="image/jpeg")
    thumb_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class HabitTask(Base):
    __tablename__ = "habit_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str] = mapped_column(String(32), nullable=False, default="rose", server_default="rose")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    owner: Mapped[User] = relationship()
    checkins: Mapped[list["HabitCheckin"]] = relationship(cascade="all, delete-orphan", back_populates="habit")


class HabitCheckin(Base):
    __tablename__ = "habit_checkins"
    __table_args__ = (UniqueConstraint("habit_id", "date", name="uq_habit_checkins_habit_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habit_tasks.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    habit: Mapped[HabitTask] = relationship(back_populates="checkins")
    user: Mapped[User] = relationship()


class HabitReminderRun(Base):
    __tablename__ = "habit_reminder_runs"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_habit_reminder_runs_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    user: Mapped[User] = relationship()


class CycleReminderSetting(Base):
    __tablename__ = "cycle_reminder_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    days_before: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    recipient_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    recipient: Mapped[User] = relationship(foreign_keys=[recipient_user_id])


class CycleReminderRun(Base):
    __tablename__ = "cycle_reminder_runs"
    __table_args__ = (UniqueConstraint("pair_id", "period_start", name="uq_cycle_reminder_runs_pair_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    recipient_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CycleDailyLog(Base):
    __tablename__ = "cycle_daily_logs"
    __table_args__ = (UniqueConstraint("pair_id", "date", name="uq_cycle_daily_logs_pair_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    phase: Mapped[CyclePhase] = mapped_column(Enum(CyclePhase), default=CyclePhase.unknown, nullable=False)
    is_period: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_predicted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    flow: Mapped[CycleFlow | None] = mapped_column(Enum(CycleFlow))
    symptoms: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    mood: Mapped[CycleMood | None] = mapped_column(Enum(CycleMood))
    bbt: Mapped[float | None] = mapped_column(Float)
    cervical_mucus: Mapped[CervicalMucus | None] = mapped_column(Enum(CervicalMucus))
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    updated_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User] = relationship(foreign_keys=[updated_by_id])


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()
    reactions: Mapped[list["CommentReaction"]] = relationship(cascade="all, delete-orphan")


class CommentReaction(Base):
    __tablename__ = "comment_reactions"
    __table_args__ = (UniqueConstraint("comment_id", "author_id", name="uq_comment_reaction_comment_author"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reaction_type: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    legacy_love_receipt_image_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Legacy disk-path column kept as an empty placeholder for old schemas and old rows.
    file_path: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    # New image uploads store bytes in MEDIA_ROOT and keep only relative keys in these columns.
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thumb_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_backend: Mapped[str] = mapped_column(String(50), nullable=False, default="local", server_default="local")
    # Legacy BLOB columns are readable for old rows; new image uploads leave them NULL.
    data: Mapped[bytes | None] = mapped_column(
        LargeBinary().with_variant(LONGBLOB(), "mysql").with_variant(LONGBLOB(), "mariadb"),
        nullable=True,
    )
    # Precomputed small preview used by timeline thumbnails so detail pages do not fetch full images first.
    thumb_data: Mapped[bytes | None] = mapped_column(
        LargeBinary().with_variant(LONGBLOB(), "mysql").with_variant(LONGBLOB(), "mariadb"),
        nullable=True,
    )
    thumb_mime_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="image/jpeg", server_default="image/jpeg"
    )
    thumb_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # 下面三个保留 NOT NULL（提供默认值），手动 INSERT 时即便不填也不会报错。
    mime_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="application/octet-stream", server_default="application/octet-stream"
    )
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class LoginLog(Base):
    __tablename__ = "login_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    device: Mapped[str | None] = mapped_column(String(200))
    os: Mapped[str | None] = mapped_column(String(100))
    browser: Mapped[str | None] = mapped_column(String(100))
    locale: Mapped[str | None] = mapped_column(String(64))
    timezone_name: Mapped[str | None] = mapped_column(String(64))
    screen: Mapped[str | None] = mapped_column(String(64))
    country: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    isp: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship()
