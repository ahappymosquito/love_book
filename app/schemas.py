"""Pydantic 契约：pair 功能、包装礼物（拆礼物状态/遮罩/收礼回应）、手账导出、合上手账、见面清单 Todo（挂见面/单方完成/写进手账）、周期邮件提醒设置、安全密码会话、跑酷成绩、媒体和管理端接口；周期统计在没有经期锚点时预测字段为 null。"""

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, field_serializer, field_validator

from app.models import (
    CervicalMucus,
    CycleFlow,
    CycleMood,
    CyclePhase,
    EventKind,
    GiftFeeling,
    LoveReceiptImageKind,
    LoveReceiptMood,
    LoveReceiptStatus,
    LoveReceiptType,
    TodoCategory,
    VisibilityMode,
)


class APIModel(BaseModel):
    # DATETIME 列不保存时区偏移，带偏移的输入必须先换算成 UTC，否则 +08:00 的钟面时间会被当成 UTC 存下。
    @field_validator("*", mode="after", check_fields=False)
    @classmethod
    def normalize_datetime(cls, value: object) -> object:
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc)
        return value

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
    email: str | None = Field(default=None, max_length=255)


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
    dissolved_at: datetime | None = None


class MeOut(APIModel):
    user: UserOut
    counterpart: UserOut
    pair_id: int
    love_started_on: date


class PairDissolveIn(APIModel):
    message: str | None = Field(default=None, max_length=500)

    @field_validator("message")
    @classmethod
    def strip_optional_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class PasswordLoginIn(APIModel):
    login_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=128)


class PasswordSessionOut(APIModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime


class SecurityPasswordOut(APIModel):
    login_name: str | None = None
    configured: bool
    password_updated_at: datetime | None = None


class SecurityPasswordUpdateIn(APIModel):
    login_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=128)


class SecurityPasswordUpdateOut(PasswordSessionOut):
    security: SecurityPasswordOut


class GameScoreCreate(APIModel):
    player_name: str = Field(min_length=1, max_length=12)
    score: int = Field(ge=0, le=2_147_483_647)

    @field_validator("player_name")
    @classmethod
    def clean_player_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Player name cannot be empty")
        return value


class GameScoreOut(APIModel):
    id: int
    player_name: str
    score: int
    created_at: datetime

    model_config = {"from_attributes": True}


class LeaderboardOut(APIModel):
    items: list[GameScoreOut]
    threshold: int


class LeaderboardSubmitOut(LeaderboardOut):
    entered: bool
    rank: int | None = None


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


class QuoteSampleOut(APIModel):
    items: list[str]


class DefaultQuoteOut(APIModel):
    id: int
    text: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EventCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    occurred_at: datetime | None = None
    event_kind: EventKind = EventKind.memory
    meeting_session_id: int | None = None
    visibility_mode: VisibilityMode = VisibilityMode.public
    gift_rating: int | None = Field(default=None, ge=1, le=5)
    gift_feelings: list[GiftFeeling] = Field(default_factory=list, max_length=3)

    @field_validator("gift_feelings")
    @classmethod
    def unique_gift_feelings(cls, value: list[GiftFeeling]) -> list[GiftFeeling]:
        if len(set(value)) != len(value):
            raise ValueError("Gift feelings must be unique")
        return value


GiftWrapStyle = Literal["rose", "peach", "sage", "cream", "starry"]
GiftState = Literal["wrapped", "opened"]


class EventUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, validation_alias=AliasChoices("description", "message"))
    occurred_at: datetime | None = None
    event_kind: EventKind | None = None
    meeting_session_id: int | None = None
    visibility_mode: VisibilityMode | None = None
    gift_rating: int | None = Field(default=None, ge=1, le=5)
    gift_feelings: list[GiftFeeling] | None = Field(default=None, max_length=3)
    gift_teaser: str | None = Field(default=None, max_length=120, validation_alias=AliasChoices("gift_teaser", "teaser"))
    gift_wrap_style: GiftWrapStyle | None = Field(
        default=None, validation_alias=AliasChoices("gift_wrap_style", "wrap_style")
    )
    gift_open_at: datetime | None = Field(default=None, validation_alias=AliasChoices("gift_open_at", "open_at"))

    @field_validator("gift_feelings")
    @classmethod
    def unique_optional_gift_feelings(cls, value: list[GiftFeeling] | None) -> list[GiftFeeling] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Gift feelings must be unique")
        return value

    @field_validator("gift_teaser")
    @classmethod
    def strip_optional_teaser(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class GiftResponseIn(APIModel):
    feelings: list[GiftFeeling] = Field(default_factory=list, max_length=3)
    rating: int | None = Field(default=None, ge=1, le=5)
    feedback: str = Field(default="", max_length=2000)

    @field_validator("feelings")
    @classmethod
    def unique_feelings(cls, value: list[GiftFeeling]) -> list[GiftFeeling]:
        if len(set(value)) != len(value):
            raise ValueError("Gift feelings must be unique")
        return value


class SubmissionState(APIModel):
    current_user_submitted: bool
    counterpart_submitted: bool
    unlocked: bool


class MeetingSessionCreate(APIModel):
    title: str = Field(min_length=1, max_length=200)
    started_on: date
    ended_on: date

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Meeting title cannot be empty")
        return value


class MeetingSessionUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    started_on: date | None = None
    ended_on: date | None = None

    @field_validator("title")
    @classmethod
    def strip_optional_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Meeting title cannot be empty")
        return value


class MeetingSessionLite(APIModel):
    id: int
    title: str
    started_on: date
    ended_on: date
    started_at: datetime | None = None
    ended_at: datetime | None = None

    model_config = {"from_attributes": True}


class MeetingSessionOut(MeetingSessionLite):
    pair_id: int
    created_by_id: int
    created_at: datetime
    updated_at: datetime
    event_count: int = 0

    model_config = {"from_attributes": True}


class ImagePreviewOut(APIModel):
    id: int
    width: int | None = None
    height: int | None = None


class EventSummary(APIModel):
    id: int
    pair_id: int
    creator_id: int
    meeting_session_id: int | None = None
    meeting_session: MeetingSessionLite | None = None
    title: str
    description: str | None
    occurred_at: datetime | None
    event_kind: EventKind
    gift_rating: int | None = Field(default=None, ge=1, le=5)
    gift_feelings: list[GiftFeeling] = Field(default_factory=list, max_length=3)
    gift_state: GiftState | None = None
    gift_receiver_id: int | None = None
    gift_wrap_style: str | None = None
    gift_teaser: str | None = None
    gift_open_at: datetime | None = None
    gift_opened_at: datetime | None = None
    gift_feedback: str | None = None
    gift_responded_at: datetime | None = None
    gift_masked: bool = False
    gift_can_open: bool = False
    preview_image: ImagePreviewOut | None = None
    image_count: int = 0
    visibility_mode: VisibilityMode
    created_at: datetime
    submission_state: SubmissionState

    model_config = {"from_attributes": True}


class CommentCreate(APIModel):
    text: str = Field(min_length=1)


CommentReactionType = Literal["like", "dislike"]


class CommentReactionCreate(APIModel):
    reaction_type: CommentReactionType


class CommentReactionSummary(APIModel):
    reaction_type: CommentReactionType
    count: int
    reacted_by_me: bool = False


class CommentOut(APIModel):
    type: Literal["comment"] = "comment"
    id: int
    event_id: int
    author_id: int
    text: str
    created_at: datetime
    reactions: list[CommentReactionSummary] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ImageOut(APIModel):
    type: Literal["image"] = "image"
    id: int
    event_id: int
    author_id: int
    sort_order: int = 0
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
    images: list[ImageOut]


class EventDetail(EventSummary):
    contents: ContentsOut


JournalScope = Literal["all", "range", "meeting"]


class JournalUserOut(APIModel):
    id: int
    display_name: str
    avatar: str = ""
    avatar_has_image: bool = False
    avatar_updated_at: datetime | None = None


class JournalPairOut(APIModel):
    users: list[JournalUserOut]
    together_since: date | None = None
    together_days: int | None = None


class JournalMeetingOut(APIModel):
    id: int
    title: str
    started_on: date | None = None
    ended_on: date | None = None


class JournalImageOut(APIModel):
    id: int
    width: int | None = None
    height: int | None = None


class JournalCommentOut(APIModel):
    id: int
    author_id: int
    content: str
    created_at: datetime


class JournalGiftOut(APIModel):
    state: GiftState
    sender_id: int | None = None
    receiver_id: int | None = None
    wrap_style: str | None = None
    teaser: str | None = None
    opened_at: datetime | None = None
    feelings: list[GiftFeeling] = Field(default_factory=list)
    rating: int | None = None
    feedback: str | None = None


class JournalEntryOut(APIModel):
    id: int
    kind: EventKind
    title: str
    description: str | None = None
    occurred_at: datetime
    creator_id: int
    meeting_session_id: int | None = None
    meeting_title: str | None = None
    locked: bool = False
    images: list[JournalImageOut] = Field(default_factory=list)
    comments: list[JournalCommentOut] = Field(default_factory=list)
    gift: JournalGiftOut | None = None


class JournalMonthOut(APIModel):
    month: str
    label: str
    entries: list[JournalEntryOut]


class JournalStatsOut(APIModel):
    entry_count: int
    image_count: int
    gift_count: int
    meeting_count: int


class JournalOut(APIModel):
    scope: JournalScope
    title: str
    start: date | None = None
    end: date | None = None
    generated_at: datetime
    pair: JournalPairOut
    meetings: list[JournalMeetingOut]
    months: list[JournalMonthOut]
    stats: JournalStatsOut


class LoveReceiptImageOut(APIModel):
    id: int
    love_receipt_id: int
    author_id: int
    kind: LoveReceiptImageKind
    sort_order: int
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LoveReceiptOut(APIModel):
    id: int
    pair_id: int
    sender_id: int
    receiver_id: int
    sender: UserOut
    receiver: UserOut
    viewer_role: Literal["sender", "receiver"]
    receipt_type: LoveReceiptType
    title: str
    message: str
    expected_arrival_at: datetime | None = None
    delivered_at: datetime | None = None
    received_at: datetime | None = None
    status: LoveReceiptStatus
    require_receipt: bool
    receipt_content: str | None = None
    receipt_mood: LoveReceiptMood | None = None
    receipt_rating: int | None = Field(default=None, ge=1, le=5)
    completed_at: datetime | None = None
    timeline_event_id: int | None = None
    cover: LoveReceiptImageOut | None = None
    receipt_images: list[LoveReceiptImageOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class LoveReceiptListOut(APIModel):
    items: list[LoveReceiptOut]
    page: int
    page_size: int
    total: int
    pending_count: int
    completed_count: int
    month_count: int
    latest_status: LoveReceiptStatus | None = None


class LoveReceiptStatusUpdate(APIModel):
    status: Literal[
        LoveReceiptStatus.delivering,
        LoveReceiptStatus.delivered,
        LoveReceiptStatus.waiting_receipt,
    ]


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
    source: Literal["recorded", "predicted", "empty"] = "recorded"

    model_config = {"from_attributes": True}


class CycleStats(APIModel):
    has_prediction: bool
    current_cycle_day: int | None
    current_phase: CyclePhase
    average_cycle_length: int
    average_period_length: int
    last_period_start: date | None
    next_period_start: date | None
    next_period_end: date | None
    ovulation_date: date | None
    fertile_start: date | None
    fertile_end: date | None
    confidence: Literal["high", "medium", "low"]
    prediction_start: date | None
    prediction_end: date | None
    cycle_variation_days: int


class CycleDashboardOut(APIModel):
    logs: list[CycleDailyLogOut]
    stats: CycleStats
    is_empty: bool


class HabitTaskCreate(APIModel):
    title: str = Field(min_length=1, max_length=120)
    color: str = Field(default="rose", min_length=1, max_length=32)

    @field_validator("title", "color")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Text cannot be empty")
        return value


class HabitTaskUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, min_length=1, max_length=32)
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None

    @field_validator("title", "color")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Text cannot be empty")
        return value


class HabitTaskOut(APIModel):
    id: int
    pair_id: int
    owner_id: int
    title: str
    color: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class HabitUserDayOut(APIModel):
    user_id: int
    display_name: str
    tasks_total: int
    completed_count: int
    all_completed: bool
    completed_task_ids: list[int] = Field(default_factory=list)


class HabitDayOut(APIModel):
    date: date
    users: list[HabitUserDayOut]
    pair_all_completed: bool


class HabitDashboardOut(APIModel):
    start: date
    end: date
    tasks: list[HabitTaskOut]
    days: list[HabitDayOut]


class HabitToggleOut(APIModel):
    date: date
    task: HabitTaskOut
    checked: bool
    dashboard: HabitDashboardOut


def _strip_required_title(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("Title cannot be empty")
    return value


class TodoMeetingOut(APIModel):
    id: int
    title: str
    started_on: date
    ended_on: date

    model_config = {"from_attributes": True}


class TodoItemOut(APIModel):
    id: int
    pair_id: int
    creator_id: int
    category: TodoCategory
    title: str
    note: str | None = None
    is_archived: bool
    meeting_session_id: int | None = None
    completed_at: datetime | None = None
    completed_by_id: int | None = None
    journal_event_id: int | None = None
    comments_count: int = 0
    images_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TodoPlanOut(APIModel):
    today: date
    focus_meeting_id: int | None = None
    meetings: list[TodoMeetingOut]
    items: list[TodoItemOut]


class TodoItemCreate(APIModel):
    category: TodoCategory
    title: str = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    meeting_session_id: int | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str | None:
        return _strip_required_title(value)


class TodoItemUpdate(APIModel):
    """Partial update; send `meeting_session_id: null` explicitly to move an item back to the wish pool."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    category: TodoCategory | None = None
    meeting_session_id: int | None = None
    completed: bool | None = None
    is_archived: bool | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        return _strip_required_title(value)


class TodoJournalOut(APIModel):
    event_id: int
    created: bool


class TodoCommentCreate(APIModel):
    text: str = Field(min_length=1, max_length=2000)


class TodoCommentOut(APIModel):
    id: int
    item_id: int
    author_id: int
    author_display_name: str
    text: str
    created_at: datetime


class TodoImageOut(APIModel):
    id: int
    item_id: int
    author_id: int
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TodoItemDetail(TodoItemOut):
    comments: list[TodoCommentOut]
    images: list[TodoImageOut]


class CycleReminderSettingOut(APIModel):
    enabled: bool
    days_before: int
    recipient_user_id: int | None = None
    recipient_has_email: bool = False
    updated_by_id: int | None = None
    updated_at: datetime | None = None
    next_period_start: date | None = None
    next_send_on: date | None = None


class CycleReminderSettingUpdate(APIModel):
    enabled: bool
    days_before: int = Field(default=3, ge=1, le=7)
    recipient_user_id: int | None = None
