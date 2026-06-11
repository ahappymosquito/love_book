"""Todo board routes for pair-shared tasks, location-aware AMap candidate search, retryable category-overridable candidate confirmation, no-email single-date schedules, weather hints, two-person comment completion, shared LLM category refresh, rich AMap restaurant evidence, images, and image deletion."""

from __future__ import annotations

import logging
import random
from calendar import monthrange
from datetime import date

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app import amap_mcp
from app.ai_config import complete_todo_category, effective_amap_key
from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.media import MediaProcessingError, make_image_thumbnail
from app.models import Pair, TodoCandidate, TodoCandidateStatus, TodoCategory, TodoComment, TodoImage, TodoItem, TodoParseStatus, TodoRestaurant, TodoSchedule, User
from app.schemas import (
    TodoCandidateConfirm,
    TodoCandidateCreate,
    TodoCandidateOut,
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
    TodoWeatherOut,
)

logger = logging.getLogger(__name__)
from app.storage import (
    PRIVATE_MEDIA_CACHE_HEADERS,
    MediaStorageError,
    build_todo_image_storage_keys,
    delete_media_file,
    read_media_file,
    write_media_file,
)

router = APIRouter(prefix="/todos", tags=["todos"])
image_router = APIRouter(prefix="/todo-images", tags=["todos"])

DEFAULT_PLAY_TITLES = ["唱歌", "台球", "看电影", "拼乐高"]
NEARBY_SEARCH_RADIUS_M = 5000
TODO_CANDIDATE_LIMIT = 6


def _merge_restaurant_candidate(candidate: TodoRestaurantCandidate, detail: dict | None) -> dict:
    data = candidate.model_dump()
    if detail:
        raw = detail.get("raw") if isinstance(detail.get("raw"), dict) else detail
        data.update({key: value for key, value in detail.items() if key != "raw" and value not in (None, "", [])})
        data["raw"] = raw
    else:
        data["raw"] = data.get("raw") or {}
    return data


def _candidate_out(candidate: TodoCandidate) -> TodoCandidateOut:
    return TodoCandidateOut(
        id=candidate.id,
        raw_title=candidate.raw_title,
        category=candidate.category,
        status=candidate.status,
        amap_candidates=[TodoRestaurantCandidate(**item) for item in candidate.amap_candidates or []],
        selected_candidate=TodoRestaurantCandidate(**candidate.selected_candidate) if candidate.selected_candidate else None,
        parse_error=candidate.parse_error,
        created_at=candidate.created_at,
        updated_at=candidate.updated_at,
    )


def _poi_sort_key(candidate: dict) -> tuple[int, int, int, int]:
    distance = candidate.get("distance_m")
    distance_rank = distance if isinstance(distance, int) else 10_000_000
    rating = candidate.get("rating")
    rating_rank = -int(float(rating) * 10) if rating is not None else 0
    photos_rank = -int(candidate.get("photos_count") or 0)
    detail_rank = -sum(1 for key in ("address", "business_area", "opening_hours", "per_capita") if candidate.get(key))
    return distance_rank, rating_rank, photos_rank, detail_rank


def _dedupe_pois(candidates: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for candidate in candidates:
        key = str(candidate.get("amap_poi_id") or f"{candidate.get('name')}|{candidate.get('address')}|{candidate.get('location')}")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _search_location_aware_pois(
    db: Session,
    user: User,
    keyword: str,
    city: str | None = None,
    *,
    limit: int = TODO_CANDIDATE_LIMIT,
) -> list[dict]:
    amap_key = effective_amap_key(db)
    candidates: list[dict] = []
    if user.location_coords:
        nearby = amap_mcp.search_pois_nearby(
            user.location_coords,
            radius_m=NEARBY_SEARCH_RADIUS_M,
            keyword=keyword,
            amap_key=amap_key,
        )
        candidates.extend(sorted(nearby, key=_poi_sort_key))
    fallback_city = city or user.location_city
    if len(candidates) < limit:
        candidates.extend(amap_mcp.search_pois(keyword, fallback_city, amap_key))
    return sorted(_dedupe_pois(candidates), key=_poi_sort_key)[:limit]


def _infer_candidate_category(db: Session, title: str) -> TodoCategory:
    try:
        return TodoCategory(complete_todo_category(db, title))
    except Exception:
        lowered = title.lower()
        if any(word in title for word in ("吃", "菜", "餐", "饭", "火锅", "咖啡", "奶茶")):
            return TodoCategory.food
        if any(word in title for word in ("酒店", "宾馆", "民宿", "住宿", "住一晚")):
            return TodoCategory.stay
        if any(word in title for word in ("希望", "想要", "礼物", "许愿", "愿望")):
            return TodoCategory.wish
        if any(word in lowered for word in ("wish", "gift")):
            return TodoCategory.wish
        return TodoCategory.play


def _create_item_from_candidate(
    db: Session,
    pair: Pair,
    user: User,
    *,
    category: TodoCategory,
    title: str,
    selected_candidate: TodoRestaurantCandidate | None = None,
) -> TodoItem:
    if selected_candidate is None:
        item = TodoItem(pair_id=pair.id, creator_id=user.id, category=category, title=title)
        db.add(item)
        db.flush()
        return item

    detail: dict | None = None
    parse_status = TodoParseStatus.resolved
    parse_error = None
    if selected_candidate.amap_poi_id:
        try:
            detail = amap_mcp.restaurant_detail(selected_candidate.amap_poi_id, effective_amap_key(db))
        except amap_mcp.AmapMCPError as exc:
            parse_status = TodoParseStatus.failed
            parse_error = str(exc)
    restaurant_data = _merge_restaurant_candidate(selected_candidate, detail)
    item = TodoItem(
        pair_id=pair.id,
        creator_id=user.id,
        category=category,
        title=restaurant_data.get("name") or title,
    )
    db.add(item)
    db.flush()
    restaurant = TodoRestaurant(
        item_id=item.id,
        amap_poi_id=restaurant_data.get("amap_poi_id"),
        name=restaurant_data.get("name") or title,
        address=restaurant_data.get("address"),
        location=restaurant_data.get("location"),
        city=restaurant_data.get("city"),
        adname=restaurant_data.get("adname"),
        pname=restaurant_data.get("pname"),
        poi_type=restaurant_data.get("poi_type"),
        poi_typecode=restaurant_data.get("poi_typecode"),
        tel=restaurant_data.get("tel"),
        business_area=restaurant_data.get("business_area"),
        signature_dishes=restaurant_data.get("signature_dishes"),
        per_capita=restaurant_data.get("per_capita"),
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
    item.restaurant = restaurant
    return item


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoScheduleOut:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    existing_schedules = db.execute(
        select(TodoSchedule).where(TodoSchedule.pair_id == pair.id, TodoSchedule.item_id == item.id)
    ).scalars().all()
    for existing in existing_schedules:
        db.delete(existing)
    db.flush()
    schedule = TodoSchedule(pair_id=pair.id, item_id=item.id, scheduled_on=payload.scheduled_on, created_by_id=current_user.id)
    db.add(schedule)
    db.flush()
    db.refresh(schedule)
    db.commit()
    db.refresh(schedule)
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
            for candidate in _search_location_aware_pois(db, current_user, payload.keyword, payload.city)
        ]
    except amap_mcp.AmapMCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return TodoRestaurantSearchOut(candidates=candidates)


@router.get("/candidates", response_model=list[TodoCandidateOut])
def list_candidates(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TodoCandidateOut]:
    pair = get_pair_for_user(db, current_user.id)
    rows = (
        db.execute(
            select(TodoCandidate)
            .where(TodoCandidate.pair_id == pair.id)
            .order_by(TodoCandidate.created_at.desc(), TodoCandidate.id.desc())
        )
        .scalars()
        .all()
    )
    return [_candidate_out(row) for row in rows]


@router.post("/candidates", response_model=TodoCandidateOut, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: TodoCandidateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoCandidateOut:
    pair = get_pair_for_user(db, current_user.id)
    category = _infer_candidate_category(db, payload.raw_title)
    status_value = TodoCandidateStatus.ready
    amap_candidates: list[dict] = []
    selected_candidate: dict | None = None
    parse_error = None
    if category != TodoCategory.wish:
        try:
            amap_candidates = _search_location_aware_pois(db, current_user, payload.raw_title)
            if len(amap_candidates) == 1:
                selected_candidate = amap_candidates[0]
                status_value = TodoCandidateStatus.ready
            elif len(amap_candidates) > 1:
                status_value = TodoCandidateStatus.needs_choice
            else:
                status_value = TodoCandidateStatus.failed
                parse_error = "高德没有返回可确认的地点"
        except amap_mcp.AmapMCPError as exc:
            status_value = TodoCandidateStatus.failed
            parse_error = str(exc)
    row = TodoCandidate(
        pair_id=pair.id,
        creator_id=current_user.id,
        raw_title=payload.raw_title,
        category=category,
        status=status_value,
        amap_candidates=amap_candidates,
        selected_candidate=selected_candidate,
        parse_error=parse_error,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _candidate_out(row)


@router.post("/candidates/{candidate_id}/confirm", response_model=TodoItemOut, status_code=status.HTTP_201_CREATED)
def confirm_candidate(
    candidate_id: int,
    payload: TodoCandidateConfirm,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    row = db.get(TodoCandidate, candidate_id)
    if row is None or row.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo candidate not found")
    category = payload.category or row.category
    selected = payload.selected_candidate
    if selected is None and row.selected_candidate:
        selected = TodoRestaurantCandidate(**row.selected_candidate)
    if category == TodoCategory.wish:
        selected = None
    try:
        item = _create_item_from_candidate(
            db,
            pair,
            current_user,
            category=category,
            title=row.raw_title,
            selected_candidate=selected,
        )
        item_id = item.id
        db.delete(row)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Todo candidate confirmation failed", extra={"candidate_id": candidate_id})
        raise HTTPException(status_code=502, detail=f"Todo candidate confirmation failed: {exc}") from exc
    persisted_item = _ensure_pair_item(db, item_id, pair)
    return _item_out(db, persisted_item)


@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(candidate_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    row = db.get(TodoCandidate, candidate_id)
    if row is None or row.pair_id != pair.id:
        raise HTTPException(status_code=404, detail="Todo candidate not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/restaurants", response_model=TodoItemOut, status_code=status.HTTP_201_CREATED)
def create_restaurant_item(
    payload: TodoRestaurantCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TodoItemOut:
    pair = get_pair_for_user(db, current_user.id)
    candidate = payload.candidate
    item = _create_item_from_candidate(db, pair, current_user, category=TodoCategory.food, title=candidate.name, selected_candidate=candidate)
    if item.restaurant:
        if payload.signature_dishes:
            item.restaurant.signature_dishes = payload.signature_dishes
        if payload.per_capita is not None:
            item.restaurant.per_capita = payload.per_capita
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


@router.get("/items/{item_id}/weather", response_model=TodoWeatherOut | None)
def get_item_weather(item_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TodoWeatherOut | None:
    pair = get_pair_for_user(db, current_user.id)
    item = _ensure_pair_item(db, item_id, pair)
    if not item.restaurant or not item.restaurant.city:
        return None
    schedules = sorted(item.schedules, key=lambda schedule: schedule.scheduled_on)
    if not schedules:
        return None
    try:
        payload = amap_mcp.weather_for_city(item.restaurant.city, effective_amap_key(db))
    except amap_mcp.AmapMCPError:
        return None
    forecasts = payload.get("forecasts") if isinstance(payload, dict) else None
    if not isinstance(forecasts, list) or not forecasts:
        return None
    target = schedules[0].scheduled_on.isoformat()
    forecast = next((row for row in forecasts if isinstance(row, dict) and row.get("date") == target), None)
    if forecast is None:
        forecast = next((row for row in forecasts if isinstance(row, dict)), None)
    if not isinstance(forecast, dict):
        return None
    return TodoWeatherOut(
        city=str(payload.get("city") or item.restaurant.city),
        report_date=forecast.get("date"),
        day_weather=forecast.get("dayweather"),
        night_weather=forecast.get("nightweather"),
        day_temp=forecast.get("daytemp"),
        night_temp=forecast.get("nighttemp"),
        day_wind=forecast.get("daywind"),
        night_wind=forecast.get("nightwind"),
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


@image_router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo_image(image_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    image = _ensure_todo_image_visible(db, image_id, current_user, pair)
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
