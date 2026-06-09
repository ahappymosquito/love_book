"""Todo board routes for pair-shared tasks, due dates, two-person comment completion, shared LLM category refresh, rich AMap restaurant evidence, and images."""

from __future__ import annotations

import random
from calendar import monthrange
from datetime import date

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app import amap_mcp
from app.ai_config import complete_todo_category, effective_amap_key
from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.emailer import notify_todo_schedule_created
from app.media import MediaProcessingError, make_image_thumbnail
from app.models import Pair, TodoCategory, TodoComment, TodoImage, TodoItem, TodoParseStatus, TodoRestaurant, TodoSchedule, User
from app.schemas import (
    TodoCommentCreate,
    TodoCommentOut,
    TodoClassifyOpenOut,
    TodoDashboardOut,
    TodoImageOut,
    TodoItemCreate,
    TodoItemDetail,
    TodoItemOut,
    TodoItemUpdate,
    TodoLotteryOut,
    TodoLotteryRequest,
    TodoRestaurantCandidate,
    TodoRestaurantCreate,
    TodoRestaurantSearch,
    TodoRestaurantSearchOut,
    TodoScheduleCreate,
    TodoScheduleOut,
)
from app.services import active_token_for_user, counterpart
from app.storage import (
    PRIVATE_MEDIA_CACHE_HEADERS,
    MediaStorageError,
    build_todo_image_storage_keys,
    read_media_file,
    write_media_file,
)

router = APIRouter(prefix="/todos", tags=["todos"])
image_router = APIRouter(prefix="/todo-images", tags=["todos"])

DEFAULT_PLAY_TITLES = ["唱歌", "台球", "看电影", "拼乐高"]


def _merge_restaurant_candidate(candidate: TodoRestaurantCandidate, detail: dict | None) -> dict:
    data = candidate.model_dump()
    if detail:
        raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else detail
        data.update({key: value for key, value in detail.items() if key != "raw" and value not in (None, "", [])})
        data["raw"] = raw
    else:
        data["raw"] = data.get("raw") or {}
    return data


def _month_range(month: str) -> tuple[date, date]:
    try:
        year_text, month_text = month.split("-", 1)
        year = int(year_text)
        month_number = int(month_text)
        last_day = monthrange(year, month_number)[1]
    except Exception as exc:
        raise HTTPException(status_code=422, detail="month must be YYYY-MM") from exc
    return date(year, month_number, 1), date(year, month_number, last_day)


def _ensure_pair_item(db: Session, item_id: int, pair: Pair) -> TodoItem:
    item = (
        db.execute(
            select(TodoItem)
            .options(selectinload(TodoItem.restaurant), selectinload(TodoItem.schedules))
            .where(TodoItem.id == item_id)
        )
        .scalars()
        .first()
    )
    if item is None or item.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo item not found")
    return item


def _seed_default_play_items(db: Session, pair: Pair, user: User) -> None:
    existing = db.execute(
        select(func.count(TodoItem.id)).where(TodoItem.pair_id == pair.id, TodoItem.category == TodoCategory.play)
    ).scalar_one()
    if existing:
        return
    db.add_all(
        TodoItem(pair_id=pair.id, creator_id=user.id, category=TodoCategory.play, title=title)
        for title in DEFAULT_PLAY_TITLES
    )
    db.flush()


def _counts(db: Session, item_ids: list[int]) -> tuple[dict[int, int], dict[int, int], dict[int, set[int]]]:
    if not item_ids:
        return {}, {}, {}
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
    author_rows = db.execute(
        select(TodoComment.item_id, TodoComment.author_id).where(TodoComment.item_id.in_(item_ids)).distinct()
    ).all()
    authors: dict[int, set[int]] = {}
    for item_id, author_id in author_rows:
        authors.setdefault(item_id, set()).add(author_id)
    return comments, images, authors


def _pair_user_ids(pair: Pair) -> set[int]:
    return {pair.user_a_id, pair.user_b_id}


def _is_checked_in(pair: Pair, author_ids: set[int]) -> bool:
    return _pair_user_ids(pair).issubset(author_ids)


def _comment_out(comment: TodoComment) -> TodoCommentOut:
    return TodoCommentOut(
        id=comment.id,
        item_id=comment.item_id,
        author_id=comment.author_id,
        author_display_name=comment.author.display_name if comment.author else "",
        text=comment.text,
        created_at=comment.created_at,
    )


def _item_out(db: Session, item: TodoItem) -> TodoItemOut:
    pair = db.get(Pair, item.pair_id)
    comments, images, authors = _counts(db, [item.id])
    return TodoItemOut(
        id=item.id,
        pair_id=item.pair_id,
        creator_id=item.creator_id,
        category=item.category,
        title=item.title,
        note=item.note,
        is_archived=item.is_archived,
        restaurant=item.restaurant,
        schedules=[TodoScheduleOut.model_validate(schedule) for schedule in sorted(item.schedules, key=lambda s: s.scheduled_on)],
        comments_count=comments.get(item.id, 0),
        images_count=images.get(item.id, 0),
        checked_in=_is_checked_in(pair, authors.get(item.id, set())) if pair else False,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _items_out(db: Session, items: list[TodoItem]) -> list[TodoItemOut]:
    comments, images, authors = _counts(db, [item.id for item in items])
    pair_ids = {item.pair_id for item in items}
    pairs = {pair.id: pair for pair in db.execute(select(Pair).where(Pair.id.in_(pair_ids))).scalars().all()} if pair_ids else {}
    return [
        TodoItemOut(
            id=item.id,
            pair_id=item.pair_id,
            creator_id=item.creator_id,
            category=item.category,
            title=item.title,
            note=item.note,
            is_archived=item.is_archived,
            restaurant=item.restaurant,
            schedules=[TodoScheduleOut.model_validate(schedule) for schedule in sorted(item.schedules, key=lambda s: s.scheduled_on)],
            comments_count=comments.get(item.id, 0),
            images_count=images.get(item.id, 0),
            checked_in=_is_checked_in(pairs[item.pair_id], authors.get(item.id, set())) if item.pair_id in pairs else False,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


def classify_todo_category(db: Session, item: TodoItem) -> TodoCategory:
    return TodoCategory(complete_todo_category(db, item.title, item.note))


@router.get("/dashboard", response_model=TodoDashboardOut)
def dashboard(
    month: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoDashboardOut:
    pair = get_pair_for_user(db, current_user.id)
    start, end = _month_range(month)
    _seed_default_play_items(db, pair, current_user)
    items = (
        db.execute(
            select(TodoItem)
            .options(selectinload(TodoItem.restaurant), selectinload(TodoItem.schedules))
            .where(TodoItem.pair_id == pair.id, TodoItem.is_archived.is_(False))
            .order_by(TodoItem.category, TodoItem.created_at.desc(), TodoItem.id.desc())
        )
        .scalars()
        .all()
    )
    schedules = (
        db.execute(
            select(TodoSchedule)
            .where(TodoSchedule.pair_id == pair.id, TodoSchedule.scheduled_on >= start, TodoSchedule.scheduled_on <= end)
            .order_by(TodoSchedule.scheduled_on, TodoSchedule.id)
        )
        .scalars()
        .all()
    )
    return TodoDashboardOut(
        month=month,
        items=_items_out(db, items),
        schedules=[TodoScheduleOut.model_validate(schedule) for schedule in schedules],
    )


@router.post("/items", response_model=TodoItemOut, status_code=status.HTTP_201_CREATED)
def create_item(payload: TodoItemCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    item = TodoItem(
        pair_id=pair.id,
        creator_id=current_user.id,
        category=payload.category,
        title=payload.title,
        note=payload.note,
    )
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
    for field in ("title", "note", "is_archived"):
        if field in data:
            setattr(item, field, data[field])
    if item.restaurant:
        if "signature_dishes" in data:
            item.restaurant.signature_dishes = data["signature_dishes"]
        if "per_capita" in data:
            item.restaurant.per_capita = data["per_capita"]
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items/{item_id}/schedules", response_model=TodoScheduleOut, status_code=status.HTTP_201_CREATED)
def create_schedule(
    item_id: int,
    payload: TodoScheduleCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoScheduleOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    existing = db.execute(
        select(TodoSchedule).where(
            TodoSchedule.pair_id == pair.id,
            TodoSchedule.item_id == item.id,
            TodoSchedule.scheduled_on == payload.scheduled_on,
        )
    ).scalars().first()
    if existing:
        return TodoScheduleOut.model_validate(existing)
    schedule = TodoSchedule(pair_id=pair.id, item_id=item.id, scheduled_on=payload.scheduled_on, created_by_id=current_user.id)
    db.add(schedule)
    db.flush()
    db.refresh(schedule)
    other = counterpart(pair, current_user)
    recipient_token = active_token_for_user(db, other.id)
    db.commit()
    db.refresh(schedule)
    background.add_task(
        notify_todo_schedule_created,
        recipient_email=other.email,
        recipient_name=other.display_name,
        recipient_token=recipient_token,
        actor_name=current_user.display_name,
        scheduled_on=schedule.scheduled_on,
        category=item.category.value,
        item_title=item.title,
    )
    return TodoScheduleOut.model_validate(schedule)


@router.post("/items/{item_id}/classify", response_model=TodoItemOut)
def classify_item(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    try:
        item.category = TodoCategory(classify_todo_category(db, item))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LLM classification failed: {exc}") from exc
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.post("/items/classify-open", response_model=TodoClassifyOpenOut)
def classify_open_items(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoClassifyOpenOut:
    pair = get_pair_for_user(db, current_user.id)
    items = (
        db.execute(
            select(TodoItem)
            .options(selectinload(TodoItem.restaurant), selectinload(TodoItem.schedules))
            .where(TodoItem.pair_id == pair.id, TodoItem.is_archived.is_(False))
            .order_by(TodoItem.created_at.desc())
        )
        .scalars()
        .all()
    )
    _, _, authors = _counts(db, [item.id for item in items])
    open_items = [item for item in items if not _is_checked_in(pair, authors.get(item.id, set()))]
    try:
        for item in open_items:
            item.category = TodoCategory(classify_todo_category(db, item))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LLM classification failed: {exc}") from exc
    db.commit()
    for item in open_items:
        db.refresh(item)
    return TodoClassifyOpenOut(count=len(open_items), items=_items_out(db, open_items))


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    schedule = db.get(TodoSchedule, schedule_id)
    if schedule is None or schedule.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo schedule not found")
    db.delete(schedule)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/restaurants/search", response_model=TodoRestaurantSearchOut)
def search_restaurants(
    payload: TodoRestaurantSearch,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoRestaurantSearchOut:
    get_pair_for_user(db, current_user.id)
    try:
        candidates = [
            TodoRestaurantCandidate(**candidate)
            for candidate in amap_mcp.search_restaurants(payload.keyword, payload.city, effective_amap_key(db))
        ]
    except amap_mcp.AmapMCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return TodoRestaurantSearchOut(candidates=candidates)


@router.post("/restaurants", response_model=TodoItemOut, status_code=status.HTTP_201_CREATED)
def create_restaurant_item(
    payload: TodoRestaurantCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    candidate = payload.candidate
    detail: dict | None = None
    parse_status = TodoParseStatus.resolved
    parse_error = None
    if candidate.amap_poi_id:
        try:
            detail = amap_mcp.restaurant_detail(candidate.amap_poi_id, effective_amap_key(db))
        except amap_mcp.AmapMCPError as exc:
            parse_status = TodoParseStatus.failed
            parse_error = str(exc)
    restaurant_data = _merge_restaurant_candidate(candidate, detail)
    signature_dishes = payload.signature_dishes or restaurant_data.get("signature_dishes")
    per_capita = payload.per_capita if payload.per_capita is not None else restaurant_data.get("per_capita")
    item = TodoItem(pair_id=pair.id, creator_id=current_user.id, category=TodoCategory.food, title=restaurant_data.get("name") or candidate.name)
    db.add(item)
    db.flush()
    restaurant = TodoRestaurant(
        item_id=item.id,
        amap_poi_id=restaurant_data.get("amap_poi_id"),
        name=restaurant_data.get("name") or candidate.name,
        address=restaurant_data.get("address"),
        location=restaurant_data.get("location"),
        city=restaurant_data.get("city"),
        adname=restaurant_data.get("adname"),
        pname=restaurant_data.get("pname"),
        poi_type=restaurant_data.get("poi_type"),
        poi_typecode=restaurant_data.get("poi_typecode"),
        tel=restaurant_data.get("tel"),
        business_area=restaurant_data.get("business_area"),
        signature_dishes=signature_dishes,
        per_capita=per_capita,
        rating=restaurant_data.get("rating"),
        opening_hours=restaurant_data.get("opening_hours"),
        meal_ordering=restaurant_data.get("meal_ordering"),
        photos_count=restaurant_data.get("photos_count") or 0,
        first_photo_url=restaurant_data.get("first_photo_url"),
        parse_status=parse_status,
        parse_error=parse_error,
        raw=restaurant_data.get("raw"),
    )
    db.add(restaurant)
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.post("/restaurants/lottery", response_model=TodoLotteryOut)
def restaurant_lottery(
    payload: TodoLotteryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoLotteryOut:
    pair = get_pair_for_user(db, current_user.id)
    filters = [TodoItem.pair_id == pair.id, TodoItem.category == TodoCategory.food, TodoItem.is_archived.is_(False)]
    if payload.per_capita_min is not None:
        filters.append(TodoRestaurant.per_capita >= payload.per_capita_min)
    if payload.per_capita_max is not None:
        filters.append(TodoRestaurant.per_capita <= payload.per_capita_max)
    if payload.city:
        filters.append(TodoRestaurant.city.like(f"%{payload.city}%"))
    items = (
        db.execute(
            select(TodoItem)
            .join(TodoRestaurant, TodoRestaurant.item_id == TodoItem.id)
            .options(selectinload(TodoItem.restaurant), selectinload(TodoItem.schedules))
            .where(and_(*filters))
        )
        .scalars()
        .all()
    )
    if items:
        return TodoLotteryOut(item=_item_out(db, random.choice(items)))
    if payload.location and payload.radius_km:
        try:
            candidates = amap_mcp.around_restaurants(payload.location, payload.radius_km * 1000, amap_key=effective_amap_key(db))
        except amap_mcp.AmapMCPError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        if candidates:
            return TodoLotteryOut(candidate=TodoRestaurantCandidate(**random.choice(candidates)))
    return TodoLotteryOut()


@router.get("/items/{item_id}", response_model=TodoItemDetail)
def get_item_detail(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoItemDetail:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    out = _item_out(db, item)
    comments = (
        db.execute(
            select(TodoComment)
            .options(selectinload(TodoComment.author))
            .where(TodoComment.item_id == item.id)
            .order_by(TodoComment.created_at)
        )
        .scalars()
        .all()
    )
    images = db.execute(select(TodoImage).where(TodoImage.item_id == item.id).order_by(TodoImage.created_at)).scalars().all()
    return TodoItemDetail(**out.model_dump(), comments=[_comment_out(comment) for comment in comments], images=images)


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
    settings = get_settings()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported image mime type")
    body = file.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image file is too large")
    try:
        thumb = make_image_thumbnail(body)
    except MediaProcessingError as exc:
        raise HTTPException(status_code=422, detail=f"Image thumbnail could not be generated: {exc}") from exc
    storage_key, thumb_storage_key = build_todo_image_storage_keys(pair.id, item.id, content_type)
    try:
        write_media_file(storage_key, body)
        write_media_file(thumb_storage_key, thumb)
    except (MediaStorageError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Image file could not be saved: {exc}") from exc
    image = TodoImage(
        item_id=item.id,
        author_id=current_user.id,
        storage_key=storage_key,
        thumb_storage_key=thumb_storage_key,
        storage_backend=settings.media_storage,
        mime_type=content_type,
        size_bytes=len(body),
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=len(thumb),
        width=width,
        height=height,
    )
    db.add(image)
    db.commit()
    db.refresh(image)
    return TodoImageOut.model_validate(image)


def _ensure_todo_image_visible(db: Session, image_id: int, user: User, pair: Pair) -> TodoImage:
    image = db.get(TodoImage, image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Todo image not found")
    item = _ensure_pair_item(db, image.item_id, pair)
    if item.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo image not found")
    return image


@image_router.get("/{image_id}/file")
def get_todo_image_file(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, current_user, pair)
    if image.storage_key:
        stored = read_media_file(image.storage_key)
        if stored is not None:
            return Response(content=stored, media_type=image.mime_type, headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
    raise HTTPException(status_code=404, detail="Todo image file not found")


@image_router.get("/{image_id}/thumb")
def get_todo_image_thumb(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, current_user, pair)
    if image.thumb_storage_key:
        stored = read_media_file(image.thumb_storage_key)
        if stored is not None:
            return Response(content=stored, media_type=image.thumb_mime_type or "image/jpeg", headers=dict(PRIVATE_MEDIA_CACHE_HEADERS))
    raise HTTPException(status_code=404, detail="Todo image thumbnail not found")
