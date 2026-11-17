"""Todo routes for the pair's meeting plan: 吃/玩/住/准备 items attached to a meeting (optionally placed on one of its
days with a start/end minute, Notion-calendar style), one-tap completion,
"write into the journal" (todo -> timeline event with note, comments and copied photos), comments, and private images.

Todo operations never send email. Every write commits before responding. Image reads fall back to the configured
remote API only outside production (see app.media_remote).
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_pair_for_user
from app.api.image_uploads import discard_media_on_error, save_uploaded_image
from app.core.config import get_settings
from app.core.database import delete_legacy_todo_rows, get_db
from app.media_remote import remote_media_response
from app.models import Event, EventKind, Image, MeetingSession, Pair, TodoComment, TodoImage, TodoItem, User, VisibilityMode, utc_now
from app.schemas import (
    TodoCommentCreate,
    TodoCommentOut,
    TodoImageOut,
    TodoItemCreate,
    TodoItemDetail,
    TodoItemOut,
    TodoItemUpdate,
    TodoJournalOut,
    TodoMeetingOut,
    TodoPlanOut,
)
from app.services import MEETING_TZ, ensure_pair_meeting_session, find_meeting_for_date, meeting_date_for_values
from app.storage import (
    PRIVATE_MEDIA_CACHE_HEADERS,
    MediaStorageError,
    build_image_storage_keys,
    build_todo_image_storage_keys,
    delete_media_file,
    read_media_file,
    write_media_file,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/todos", tags=["todos"])
image_router = APIRouter(prefix="/todo-images", tags=["todos"])

# Journal entries for items finished after their meeting ended are dated to the meeting's last evening.
LATE_JOURNAL_TIME = time(20, 0)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _apply_schedule(db: Session, item: TodoItem, data: dict, *, meeting_changed: bool) -> None:
    """Set day/time from `data`, clearing the slot when the day is cleared or the item moves to another meeting.

    A slot needs a day inside the item's meeting; a start without an end lasts one hour (capped at midnight).
    """
    if meeting_changed and "scheduled_on" not in data:
        item.scheduled_on = item.start_minute = item.end_minute = None
        return
    if "scheduled_on" in data:
        item.scheduled_on = data["scheduled_on"]
    if "start_minute" in data:
        item.start_minute = data["start_minute"]
        if "end_minute" not in data:
            item.end_minute = None
    if "end_minute" in data:
        item.end_minute = data["end_minute"]
    if item.scheduled_on is None:
        item.start_minute = item.end_minute = None
        return
    meeting = db.get(MeetingSession, item.meeting_session_id) if item.meeting_session_id is not None else None
    if meeting is None or meeting.started_on is None or meeting.ended_on is None:
        raise HTTPException(status_code=422, detail="先放进一次见面，再排到某一天")
    if not meeting.started_on <= item.scheduled_on <= meeting.ended_on:
        raise HTTPException(status_code=422, detail="这一天不在这次见面里")
    if item.start_minute is None:
        item.end_minute = None
        return
    if item.end_minute is None:
        item.end_minute = min(item.start_minute + 60, 1440)
    if item.end_minute <= item.start_minute:
        raise HTTPException(status_code=422, detail="结束时间要晚于开始时间")


def _ensure_pair_item(db: Session, item_id: int, pair: Pair) -> TodoItem:
    item = db.get(TodoItem, item_id)
    if item is None or item.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo item not found")
    return item


def _items_out(db: Session, items: list[TodoItem]) -> list[TodoItemOut]:
    item_ids = [item.id for item in items]
    if not item_ids:
        return []
    comments = dict(
        db.execute(
            select(TodoComment.item_id, func.count(TodoComment.id)).where(TodoComment.item_id.in_(item_ids)).group_by(TodoComment.item_id)
        ).all()
    )
    images = dict(
        db.execute(
            select(TodoImage.item_id, func.count(TodoImage.id)).where(TodoImage.item_id.in_(item_ids)).group_by(TodoImage.item_id)
        ).all()
    )
    journal_ids = {item.journal_event_id for item in items if item.journal_event_id is not None}
    live_journal_ids = (
        set(db.execute(select(Event.id).where(Event.id.in_(journal_ids), Event.pair_id == items[0].pair_id)).scalars().all())
        if journal_ids
        else set()
    )
    return [
        TodoItemOut.model_validate(item).model_copy(
            update={
                "comments_count": comments.get(item.id, 0),
                "images_count": images.get(item.id, 0),
                "journal_event_id": item.journal_event_id if item.journal_event_id in live_journal_ids else None,
            }
        )
        for item in items
    ]


def _item_out(db: Session, item: TodoItem) -> TodoItemOut:
    return _items_out(db, [item])[0]


def _comment_out(comment: TodoComment) -> TodoCommentOut:
    return TodoCommentOut(
        id=comment.id,
        item_id=comment.item_id,
        author_id=comment.author_id,
        author_display_name=comment.author.display_name if comment.author else "",
        text=comment.text,
        created_at=comment.created_at,
    )


def _ordered_comments(db: Session, item_id: int) -> list[TodoComment]:
    return list(
        db.execute(
            select(TodoComment)
            .options(selectinload(TodoComment.author))
            .where(TodoComment.item_id == item_id)
            .order_by(TodoComment.created_at, TodoComment.id)
        )
        .scalars()
        .all()
    )


@router.get("/plan", response_model=TodoPlanOut)
def plan(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoPlanOut:
    pair = get_pair_for_user(db, current_user.id)
    today = datetime.now(MEETING_TZ).date()
    items = (
        db.execute(
            select(TodoItem)
            .where(TodoItem.pair_id == pair.id, TodoItem.is_archived.is_(False))
            .order_by(TodoItem.created_at, TodoItem.id)
        )
        .scalars()
        .all()
    )
    referenced_meeting_ids = {item.meeting_session_id for item in items if item.meeting_session_id is not None}
    meetings = (
        db.execute(
            select(MeetingSession).where(
                MeetingSession.pair_id == pair.id,
                MeetingSession.started_on.is_not(None),
                MeetingSession.ended_on.is_not(None),
            )
        )
        .scalars()
        .all()
    )
    visible = sorted(
        (meeting for meeting in meetings if meeting.ended_on >= today or meeting.id in referenced_meeting_ids),
        key=lambda meeting: (meeting.started_on, meeting.id),
    )
    focus = next((meeting for meeting in visible if meeting.ended_on >= today), None)
    return TodoPlanOut(
        today=today,
        focus_meeting_id=focus.id if focus else None,
        meetings=[TodoMeetingOut.model_validate(meeting) for meeting in visible],
        items=_items_out(db, list(items)),
    )


@router.post("/items", response_model=TodoItemOut, status_code=status.HTTP_201_CREATED)
def create_item(payload: TodoItemCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    if payload.meeting_session_id is not None:
        ensure_pair_meeting_session(db, payload.meeting_session_id, pair)
    item = TodoItem(
        pair_id=pair.id,
        creator_id=current_user.id,
        category=payload.category,
        title=payload.title,
        note=payload.note,
        meeting_session_id=payload.meeting_session_id,
    )
    _apply_schedule(db, item, payload.model_dump(include={"scheduled_on", "start_minute", "end_minute"}, exclude_none=True), meeting_changed=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.patch("/items/{item_id}", response_model=TodoItemOut)
def update_item(
    item_id: int,
    payload: TodoItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    data = payload.model_dump(exclude_unset=True)
    for field in ("title", "note", "category", "is_archived"):
        if field in data and (data[field] is not None or field == "note"):
            setattr(item, field, data[field])
    meeting_changed = False
    if "meeting_session_id" in data:
        meeting_id = data["meeting_session_id"]
        if meeting_id is not None:
            ensure_pair_meeting_session(db, meeting_id, pair)
        meeting_changed = meeting_id != item.meeting_session_id
        item.meeting_session_id = meeting_id
    if meeting_changed or data.keys() & {"scheduled_on", "start_minute", "end_minute"}:
        _apply_schedule(db, item, data, meeting_changed=meeting_changed)
    if data.get("completed") is True and item.completed_at is None:
        item.completed_at = utc_now()
        item.completed_by_id = current_user.id
    elif data.get("completed") is False:
        item.completed_at = None
        item.completed_by_id = None
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    storage_keys = [key for image in item.images for key in (image.storage_key, image.thumb_storage_key) if key]
    delete_legacy_todo_rows(db, item.id)
    db.delete(item)
    db.commit()
    for storage_key in storage_keys:
        try:
            delete_media_file(storage_key)
        except MediaStorageError:
            logger.exception("Todo image file deletion failed", extra={"item_id": item_id, "storage_key": storage_key})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _journal_occurred_at(db: Session, item: TodoItem, pair: Pair) -> datetime:
    completed_at = _aware(item.completed_at or utc_now())
    if item.scheduled_on is not None and item.start_minute is not None:
        slot = datetime.combine(item.scheduled_on, time(item.start_minute // 60, item.start_minute % 60), MEETING_TZ)
        if slot.astimezone(timezone.utc) <= completed_at:
            return slot.astimezone(timezone.utc)
    meeting = db.get(MeetingSession, item.meeting_session_id) if item.meeting_session_id is not None else None
    if meeting is None or meeting.pair_id != pair.id or meeting.ended_on is None:
        return completed_at
    if completed_at.astimezone(MEETING_TZ).date() > meeting.ended_on:
        return datetime.combine(meeting.ended_on, LATE_JOURNAL_TIME, MEETING_TZ).astimezone(timezone.utc)
    return completed_at


def _journal_description(item: TodoItem, comments: list[TodoComment]) -> str | None:
    lines: list[str] = []
    if item.note and item.note.strip():
        lines.append(item.note.strip())
    if comments:
        if lines:
            lines.append("")
        lines.extend(f"{comment.author.display_name if comment.author else ''}：{comment.text}" for comment in comments)
    return "\n".join(lines) or None


@router.post("/items/{item_id}/journal", response_model=TodoJournalOut)
def write_into_journal(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoJournalOut:
    """Turn a finished todo into a public timeline event once; repeated calls return the existing entry."""
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    if item.completed_at is None:
        raise HTTPException(status_code=409, detail="先把这件事标成完成，再写进手账")
    if item.journal_event_id is not None:
        existing = db.get(Event, item.journal_event_id)
        if existing is not None and existing.pair_id == pair.id:
            return TodoJournalOut(event_id=existing.id, created=False)

    created_at = utc_now()
    occurred_at = _journal_occurred_at(db, item, pair)
    meeting = find_meeting_for_date(db, pair.id, meeting_date_for_values(occurred_at, created_at))
    event = Event(
        pair_id=pair.id,
        creator_id=current_user.id,
        meeting_session_id=meeting.id if meeting else None,
        title=item.title,
        description=_journal_description(item, _ordered_comments(db, item.id)),
        occurred_at=occurred_at,
        event_kind=EventKind.offline_meeting if meeting else EventKind.memory,
        gift_feelings=[],
        visibility_mode=VisibilityMode.public,
        created_at=created_at,
    )
    todo_images = db.execute(select(TodoImage).where(TodoImage.item_id == item.id).order_by(TodoImage.created_at, TodoImage.id)).scalars().all()
    written_keys: list[str] = []
    with discard_media_on_error(db, written_keys):
        db.add(event)
        db.flush()
        sort_order = 0
        for todo_image in todo_images:
            original = read_media_file(todo_image.storage_key) if todo_image.storage_key else None
            if original is None:
                continue
            thumb = read_media_file(todo_image.thumb_storage_key) if todo_image.thumb_storage_key else None
            storage_key, thumb_key = build_image_storage_keys(pair.id, event.id, todo_image.mime_type)
            write_media_file(storage_key, original)
            written_keys.append(storage_key)
            if thumb is not None:
                write_media_file(thumb_key, thumb)
                written_keys.append(thumb_key)
            db.add(
                Image(
                    event_id=event.id,
                    author_id=todo_image.author_id,
                    sort_order=sort_order,
                    file_path="",
                    storage_key=storage_key,
                    thumb_storage_key=thumb_key if thumb is not None else None,
                    storage_backend=get_settings().media_storage,
                    data=None,
                    thumb_data=None,
                    thumb_mime_type="image/jpeg",
                    thumb_size_bytes=len(thumb) if thumb is not None else 0,
                    mime_type=todo_image.mime_type,
                    size_bytes=len(original),
                )
            )
            sort_order += 1
        item.journal_event_id = event.id
        db.commit()
    return TodoJournalOut(event_id=event.id, created=True)


@router.get("/items/{item_id}", response_model=TodoItemDetail)
def get_item_detail(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoItemDetail:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    out = _item_out(db, item)
    images = db.execute(select(TodoImage).where(TodoImage.item_id == item.id).order_by(TodoImage.created_at)).scalars().all()
    return TodoItemDetail(
        **out.model_dump(),
        comments=[_comment_out(comment) for comment in _ordered_comments(db, item.id)],
        images=images,
    )


@router.post("/items/{item_id}/comments", response_model=TodoCommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(
    item_id: int,
    payload: TodoCommentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoCommentOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    comment = TodoComment(item_id=item.id, author_id=current_user.id, text=payload.text.strip())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    comment.author = current_user
    return _comment_out(comment)


@router.post("/items/{item_id}/images", response_model=TodoImageOut, status_code=status.HTTP_201_CREATED)
def upload_image(
    item_id: int,
    file: UploadFile = File(...),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoImageOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    stored = save_uploaded_image(file, lambda mime: build_todo_image_storage_keys(pair.id, item.id, mime))
    with discard_media_on_error(db, stored.keys):
        image = TodoImage(
            item_id=item.id,
            author_id=current_user.id,
            storage_key=stored.storage_key,
            thumb_storage_key=stored.thumb_storage_key,
            storage_backend=get_settings().media_storage,
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            thumb_mime_type="image/jpeg",
            thumb_size_bytes=stored.thumb_size_bytes,
            width=width,
            height=height,
        )
        db.add(image)
        db.commit()
    db.refresh(image)
    return TodoImageOut.model_validate(image)


def _ensure_todo_image_visible(db: Session, image_id: int, pair: Pair) -> TodoImage:
    image = db.get(TodoImage, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Todo image not found")
    _ensure_pair_item(db, image.item_id, pair)
    return image


@image_router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo_image(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, pair)
    storage_keys = [key for key in (image.storage_key, image.thumb_storage_key) if key]
    db.delete(image)
    db.commit()
    for storage_key in storage_keys:
        try:
            delete_media_file(storage_key)
        except MediaStorageError:
            logger.exception("Todo image file deletion failed", extra={"image_id": image_id, "storage_key": storage_key})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@image_router.get("/{image_id}/file")
def get_todo_image_file(
    image_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, pair)
    if image.storage_key:
        stored = read_media_file(image.storage_key)
        if stored is not None:
            return Response(content=stored, media_type=image.mime_type, headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
        if (remote := remote_media_response(request)) is not None:
            return remote
    raise HTTPException(status_code=404, detail="Todo image file not found")


@image_router.get("/{image_id}/thumb")
def get_todo_image_thumb(
    image_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, pair)
    if image.thumb_storage_key:
        stored = read_media_file(image.thumb_storage_key)
        if stored is not None:
            return Response(content=stored, media_type=image.thumb_mime_type or "image/jpeg", headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
        if (remote := remote_media_response(request)) is not None:
            return remote
    raise HTTPException(status_code=404, detail="Todo image thumbnail not found")
