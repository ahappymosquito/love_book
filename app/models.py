from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class VisibilityMode(StrEnum):
    public = "public"
    mutual_submit = "mutual_submit"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Pair(Base):
    __tablename__ = "pairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_a_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True)
    user_b_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True)
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


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    author: Mapped[User] = relationship()


class Voice(Base):
    __tablename__ = "voices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
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
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
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
