"""Pydantic schemas for auth, avatar-aware users, admin, pair, event, quote, content, cycle, and reminder APIs."""

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.models import CervicalMucus, CycleFlow, CycleMood, CyclePhase, VisibilityMode


class APIModel(BaseModel):
    @field_serializer("*", when_used="json", check_fields=False)
    def serialize_datetime(self, value: object) -> object:
        if not isinstance(value, datetime):
            return value
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class UserOut(APIModel):
    id: int
    display_name: str
    avatar: str = ""
    avatar_has_image: bool = False
    avatar_updated_at: datetime | None = None
    email: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MeUpdate(APIModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar: str | None = Field(default=None, max_length=64)


class AdminAuthRequest(APIModel):
    admin_key: str = Field(min_length=1)


class AdminAuthResponse(APIModel):
    ok: bool = True


class PairCreate(APIModel):
    user_a_display_name: str = Field(min_length=1, max_length=100)
    user_b_display_name: str = Field(min_length=1, max_length=100)
    user_a_avatar: str = Field(default="", max_length=64)
    user_b_avatar: str = Field(default="", max_length=64)
    user_a_email: str | None = Field(default=None, max_length=255)
    user_b_email: str | None = Field(default=None, max_length=255)
    love_started_on: date | None = None
    token_expires_at: datetime | None = None


class PairUpdate(APIModel):
    user_a_email: str | None = Field(default=None, max_length=255)
    user_b_email: str | None = Field(default=None, max_length=255)
    love_started_on: date | None = None


class PairCreated(APIModel):
    pair_id: int
    user_a: UserOut
    user_b: UserOut
    love_started_on: date
    user_a_token: str
    user_b_token: str
    user_a_token_expires_at: datetime | None = None
    user_b_token_expires_at: datetime | None = None


class PairOut(PairCreated):
    created_at: datetime


class MeOut(APIModel):
    user: UserOut
    counterpart: UserOut
    pair_id: int
    love_started_on: date


class ReminderItem(APIModel):
    type: Literal["anniversary", "love_festival", "holiday", "workday"]
    label: str
    message: str | None = None


class AnniversaryOut(APIModel):
    love_started_on: date
    today: date
    days_together: int
    anniversary_items: list[ReminderItem]
    love_festival_items: list[ReminderItem]
    holiday_items: list[ReminderItem]
    message: str
    message_source: Literal["anniversary", "love_festival", "holiday", "local"]


class QuoteCreate(APIModel):
    text: str = Field(min_length=1, max_length=500)

    @field_validator("text")
    @classmethod
    def strip_and_require_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Quote text cannot be empty")
        return value


class QuoteOut(APIModel):
    id: int
    pair_id: int
    author_id: int
    text: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EventCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    occurred_at: datetime | None = None
    visibility_mode: VisibilityMode = VisibilityMode.public


class EventUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    occurred_at: datetime | None = None
    visibility_mode: VisibilityMode | None = None


class SubmissionState(APIModel):
    current_user_submitted: bool
    counterpart_submitted: bool
    unlocked: bool


class EventSummary(APIModel):
    id: int
    pair_id: int
    creator_id: int
    title: str
    description: str | None
    occurred_at: datetime | None
    visibility_mode: VisibilityMode
    created_at: datetime
    submission_state: SubmissionState

    model_config = {"from_attributes": True}


class CommentCreate(APIModel):
    text: str = Field(min_length=1)


class CommentOut(APIModel):
    type: Literal["comment"] = "comment"
    id: int
    event_id: int
    author_id: int
    text: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VoiceOut(APIModel):
    type: Literal["voice"] = "voice"
    id: int
    event_id: int
    author_id: int
    duration_ms: int | None
    mime_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ImageOut(APIModel):
    type: Literal["image"] = "image"
    id: int
    event_id: int
    author_id: int
    # 手动 INSERT 时这两项可能没填，给个保底值即可
    mime_type: str | None = "application/octet-stream"
    size_bytes: int | None = 0
    width: int | None = None
    height: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentsOut(APIModel):
    submission_state: SubmissionState
    comments: list[CommentOut]
    voices: list[VoiceOut]
    images: list[ImageOut]


class EventDetail(EventSummary):
    contents: ContentsOut


class LoginRecordCreate(APIModel):
    user_agent: str | None = Field(default=None, max_length=500)
    locale: str | None = Field(default=None, max_length=64)
    timezone_name: str | None = Field(default=None, max_length=64)
    screen: str | None = Field(default=None, max_length=64)


class LoginLogOut(APIModel):
    id: int
    user_id: int
    user: UserOut | None = None
    ip: str | None
    user_agent: str | None
    device: str | None
    os: str | None
    browser: str | None
    locale: str | None
    timezone_name: str | None
    screen: str | None
    country: str | None
    region: str | None
    city: str | None
    isp: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CycleDailyLogBase(APIModel):
    phase: CyclePhase = CyclePhase.unknown
    is_period: bool = False
    is_predicted: bool = False
    flow: CycleFlow | None = None
    symptoms: list[str] = Field(default_factory=list)
    mood: CycleMood | None = None
    bbt: float | None = Field(default=None, ge=34, le=42)
    cervical_mucus: CervicalMucus | None = None
    note: str | None = Field(default=None, max_length=1000)


class CycleDailyLogUpsert(CycleDailyLogBase):
    pass


class CycleDailyLogOut(CycleDailyLogBase):
    date: date
    updated_by_id: int | None = None
    updated_at: datetime | None = None
    source: Literal["recorded", "predicted"] = "recorded"

    model_config = {"from_attributes": True}


class CycleStats(APIModel):
    current_cycle_day: int
    current_phase: CyclePhase
    average_cycle_length: int
    average_period_length: int
    last_period_start: date
    next_period_start: date
    next_period_end: date
    ovulation_date: date
    fertile_start: date
    fertile_end: date
    confidence: Literal["high", "medium", "low"]
    prediction_start: date
    prediction_end: date
    cycle_variation_days: int


class CycleDashboardOut(APIModel):
    logs: list[CycleDailyLogOut]
    stats: CycleStats
    is_empty: bool
