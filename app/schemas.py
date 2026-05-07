from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_serializer

from app.models import VisibilityMode


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
    token_expires_at: datetime | None = None


class PairCreated(APIModel):
    pair_id: int
    user_a: UserOut
    user_b: UserOut
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
    mime_type: str
    size_bytes: int
    width: int | None
    height: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentsOut(APIModel):
    submission_state: SubmissionState
    comments: list[CommentOut]
    voices: list[VoiceOut]
    images: list[ImageOut]


class EventDetail(EventSummary):
    contents: ContentsOut
