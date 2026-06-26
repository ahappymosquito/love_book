"""Pydantic schemas for auth, editable profiles with location preferences, admin saved-model AMap-grounded food/play/stay AI tests with an enable switch, rich AMap restaurant evidence, habit check-ins, manual todo candidate queues, events, media, quotes, cycle records with empty/predicted days, and todo APIs."""

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.models import AIProtocol, CervicalMucus, CycleFlow, CycleMood, CyclePhase, TodoCandidateStatus, TodoCategory, TodoParseStatus, VisibilityMode


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
    location_label: str | None = None
    location_address: str | None = None
    location_city: str | None = None
    location_coords: str | None = None
    location_updated_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MeUpdate(APIModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=255)


class MeLocationUpdate(APIModel):
    label: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=100)
    coords: str | None = Field(default=None, max_length=100)

    @field_validator("label", "address", "city", "coords")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


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


class DefaultQuoteOut(APIModel):
    id: int
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
    source: Literal["recorded", "predicted", "empty"] = "recorded"

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


class TodoRestaurantOut(APIModel):
    id: int
    item_id: int
    amap_poi_id: str | None = None
    name: str
    address: str | None = None
    location: str | None = None
    city: str | None = None
    adname: str | None = None
    pname: str | None = None
    poi_type: str | None = None
    poi_typecode: str | None = None
    tel: str | None = None
    business_area: str | None = None
    signature_dishes: str | None = None
    per_capita: int | None = None
    rating: float | None = None
    opening_hours: str | None = None
    meal_ordering: str | None = None
    photos_count: int = 0
    first_photo_url: str | None = None
    amap_navigation_url: str | None = None
    display_facts: list[dict[str, str | None]] = Field(default_factory=list)
    parse_status: TodoParseStatus
    parse_error: str | None = None
    raw: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TodoScheduleOut(APIModel):
    id: int
    item_id: int
    scheduled_on: date
    created_by_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TodoItemOut(APIModel):
    id: int
    pair_id: int
    creator_id: int
    category: TodoCategory
    title: str
    note: str | None = None
    is_archived: bool
    restaurant: TodoRestaurantOut | None = None
    schedules: list[TodoScheduleOut] = Field(default_factory=list)
    comments_count: int = 0
    images_count: int = 0
    checked_in: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TodoDashboardOut(APIModel):
    month: str
    items: list[TodoItemOut]
    schedules: list[TodoScheduleOut]
    llm_enabled: bool = False


class TodoClassifyOpenOut(APIModel):
    count: int
    items: list[TodoItemOut]


class TodoItemCreate(APIModel):
    category: TodoCategory
    title: str = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title cannot be empty")
        return value


class TodoItemUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    is_archived: bool | None = None
    signature_dishes: str | None = Field(default=None, max_length=1000)
    per_capita: int | None = Field(default=None, ge=0, le=100000)


class TodoScheduleCreate(APIModel):
    scheduled_on: date


class TodoRestaurantSearch(APIModel):
    keyword: str = Field(min_length=1, max_length=100)
    city: str | None = Field(default=None, max_length=100)

    @field_validator("keyword", "city")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class TodoRestaurantCandidate(APIModel):
    amap_poi_id: str | None = None
    name: str
    address: str | None = None
    location: str | None = None
    distance_m: int | None = None
    city: str | None = None
    adname: str | None = None
    pname: str | None = None
    poi_type: str | None = None
    poi_typecode: str | None = None
    tel: str | None = None
    business_area: str | None = None
    rating: float | None = None
    per_capita: int | None = None
    opening_hours: str | None = None
    meal_ordering: str | None = None
    tags: list[str] = Field(default_factory=list)
    signature_dishes: str | None = None
    photos_count: int = 0
    first_photo_url: str | None = None
    amap_navigation_url: str | None = None
    raw: dict | None = None


class TodoRestaurantSearchOut(APIModel):
    candidates: list[TodoRestaurantCandidate]


class TodoRestaurantCreate(APIModel):
    candidate: TodoRestaurantCandidate
    signature_dishes: str | None = Field(default=None, max_length=1000)
    per_capita: int | None = Field(default=None, ge=0, le=100000)


class TodoCandidateCreate(APIModel):
    raw_title: str = Field(min_length=1, max_length=200)
    category: TodoCategory | None = None

    @field_validator("raw_title")
    @classmethod
    def strip_raw_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Title cannot be empty")
        return value


class TodoCandidateConfirm(APIModel):
    category: TodoCategory | None = None
    selected_candidate: TodoRestaurantCandidate | None = None


class TodoCandidateOut(APIModel):
    id: int
    raw_title: str
    category: TodoCategory
    status: TodoCandidateStatus
    amap_candidates: list[TodoRestaurantCandidate] = Field(default_factory=list)
    selected_candidate: TodoRestaurantCandidate | None = None
    parse_error: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TodoLotteryRequest(APIModel):
    per_capita_min: int | None = Field(default=None, ge=0)
    per_capita_max: int | None = Field(default=None, ge=0)
    location: str | None = Field(default=None, max_length=100)
    radius_km: int | None = Field(default=None, ge=1, le=10)
    city: str | None = Field(default=None, max_length=100)


class TodoLotteryOut(APIModel):
    item: TodoItemOut | None = None
    candidate: TodoRestaurantCandidate | None = None


class TodoWeatherOut(APIModel):
    city: str
    report_date: str | None = None
    day_weather: str | None = None
    night_weather: str | None = None
    day_temp: str | None = None
    night_temp: str | None = None
    day_wind: str | None = None
    night_wind: str | None = None


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


class AdminAIConfigOut(APIModel):
    llm_enabled: bool
    protocol: AIProtocol
    selected_model: str
    env_model: str
    openai_base_url: str
    anthropic_base_url: str
    api_key: str
    api_key_preview: str
    has_api_key: bool
    amap_api_key: str
    amap_key_preview: str
    has_amap_key: bool
    saved_models: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None


class AdminAIConfigUpdate(APIModel):
    llm_enabled: bool = False
    protocol: AIProtocol
    selected_model: str = Field(default="", max_length=200)
    openai_base_url: str = Field(min_length=1, max_length=500)
    anthropic_base_url: str = Field(min_length=1, max_length=500)
    api_key: str = Field(default="", max_length=4000)
    amap_api_key: str = Field(default="", max_length=200)


class AdminAIModelListOut(APIModel):
    models: list[str]


class AdminAIConnectionTestIn(APIModel):
    keyword: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    expected_category: TodoCategory | None = None

    @field_validator("keyword", "city")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class AdminAIConnectionTestOut(APIModel):
    ok: bool
    message: str
    sample_category: TodoCategory | None = None
    sample_keyword: str | None = None
    sample_city: str | None = None
    expected_category: TodoCategory | None = None
    category_matched: bool | None = None
    amap_name: str | None = None
    amap_address: str | None = None
    amap_poi_type: str | None = None
    amap_poi_typecode: str | None = None
    amap_poi_id: str | None = None
    amap_city: str | None = None
    amap_adname: str | None = None
    amap_tel: str | None = None
    amap_business_area: str | None = None
    rating: float | None = None
    per_capita: int | None = None
    tags: list[str] = Field(default_factory=list)
    signature_dishes: str | None = None
    photos_count: int = 0
    first_photo_url: str | None = None
    amap_category: TodoCategory | None = None
    amap_category_reason: str | None = None
    llm_category: TodoCategory | None = None
    llm_status: str | None = None
    llm_message: str | None = None
    evidence_note: str | None = None
