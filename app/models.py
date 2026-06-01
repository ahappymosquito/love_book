"""SQLAlchemy models for pair timelines, comment reactions, todo boards, media keys, quotes, AI settings, and login logs."""

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


class TodoParseStatus(StrEnum):
    pending = "pending"
    resolved = "resolved"
    failed = "failed"


class AIProtocol(StrEnum):
    openai = "openai"
    anthropic = "anthropic"


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user_a: Mapped[User] = relationship(foreign_keys=[user_a_id])
    user_b: Mapped[User] = relationship(foreign_keys=[user_b_id])


class DeviceToken(Base):
    __tablename__ = "device_tokens"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    user: Mapped[User] = relationship()


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    visibility_mode: Mapped[VisibilityMode] = mapped_column(
        Enum(VisibilityMode), default=VisibilityMode.public, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    creator: Mapped[User] = relationship()
    comments: Mapped[list["Comment"]] = relationship(cascade="all, delete-orphan")
    voices: Mapped[list["Voice"]] = relationship(cascade="all, delete-orphan")
    images: Mapped[list["Image"]] = relationship(cascade="all, delete-orphan")


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    pair: Mapped[Pair] = relationship()
    creator: Mapped[User] = relationship()
    restaurant: Mapped["TodoRestaurant | None"] = relationship(cascade="all, delete-orphan", uselist=False)
    schedules: Mapped[list["TodoSchedule"]] = relationship(cascade="all, delete-orphan", back_populates="item")
    comments: Mapped[list["TodoComment"]] = relationship(cascade="all, delete-orphan")
    images: Mapped[list["TodoImage"]] = relationship(cascade="all, delete-orphan")


class TodoRestaurant(Base):
    __tablename__ = "todo_restaurants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("todo_items.id"), nullable=False, unique=True, index=True)
    amap_poi_id: Mapped[str | None] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    poi_type: Mapped[str | None] = mapped_column(String(200))
    tel: Mapped[str | None] = mapped_column(String(200))
    business_area: Mapped[str | None] = mapped_column(String(200))
    signature_dishes: Mapped[str | None] = mapped_column(Text)
    per_capita: Mapped[int | None] = mapped_column(Integer)
    parse_status: Mapped[TodoParseStatus] = mapped_column(
        Enum(TodoParseStatus), default=TodoParseStatus.pending, nullable=False, index=True
    )
    parse_error: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class TodoSchedule(Base):
    __tablename__ = "todo_schedules"
    __table_args__ = (UniqueConstraint("pair_id", "item_id", "scheduled_on", name="uq_todo_schedule_pair_item_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pair_id: Mapped[int] = mapped_column(ForeignKey("pairs.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("todo_items.id"), nullable=False, index=True)
    scheduled_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    item: Mapped[TodoItem] = relationship(back_populates="schedules")
    created_by: Mapped[User] = relationship()


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


class AISetting(Base):
    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    protocol: Mapped[AIProtocol] = mapped_column(Enum(AIProtocol), default=AIProtocol.openai, nullable=False)
    selected_model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


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


class Voice(Base):
    __tablename__ = "voices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Legacy disk-path column kept as an empty placeholder for old schemas and old rows.
    file_path: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    # New voice uploads store normalized MP3 bytes in MEDIA_ROOT and keep only a relative key.
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_backend: Mapped[str] = mapped_column(String(50), nullable=False, default="local", server_default="local")
    # Legacy BLOB column is readable for old rows; new voice uploads leave it NULL.
    data: Mapped[bytes | None] = mapped_column(
        LargeBinary().with_variant(LONGBLOB(), "mysql").with_variant(LONGBLOB(), "mariadb"),
        nullable=True,
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class Image(Base):
    __tablename__ = "images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
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
