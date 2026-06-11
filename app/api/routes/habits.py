"""Authenticated habit routes for personal task management, pair-visible dashboards, and date-based check-in toggles."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.habits import build_dashboard, ensure_pair_habit, next_sort_order, toggle_checkin
from app.models import HabitTask, User
from app.schemas import HabitDashboardOut, HabitTaskCreate, HabitTaskOut, HabitTaskUpdate, HabitToggleOut

router = APIRouter(prefix="/habits", tags=["habits"])


@router.get("/dashboard", response_model=HabitDashboardOut)
def read_habit_dashboard(
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HabitDashboardOut:
    if end < start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end must be on or after start")
    if (end - start).days > 120:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date range is too large")
    pair = get_pair_for_user(db, current_user.id)
    return build_dashboard(db, pair, start, end)


@router.post("/tasks", response_model=HabitTaskOut, status_code=status.HTTP_201_CREATED)
def create_habit_task(
    payload: HabitTaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HabitTaskOut:
    pair = get_pair_for_user(db, current_user.id)
    task = HabitTask(
        pair_id=pair.id,
        owner_id=current_user.id,
        title=payload.title,
        color=payload.color,
        sort_order=next_sort_order(db, pair, current_user),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return HabitTaskOut.model_validate(task)


@router.patch("/tasks/{task_id}", response_model=HabitTaskOut)
def update_habit_task(
    task_id: int,
    payload: HabitTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HabitTaskOut:
    pair = get_pair_for_user(db, current_user.id)
    task = ensure_pair_habit(db, pair, task_id)
    if task is None or task.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit task not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return HabitTaskOut.model_validate(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    task = ensure_pair_habit(db, pair, task_id)
    if task is None or task.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit task not found")
    task.is_active = False
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/tasks/{task_id}/toggle", response_model=HabitToggleOut)
def toggle_habit_task(
    task_id: int,
    target_date: date,
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HabitToggleOut:
    if end < start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end must be on or after start")
    if (end - start).days > 120:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date range is too large")
    pair = get_pair_for_user(db, current_user.id)
    task = ensure_pair_habit(db, pair, task_id)
    if task is None or task.owner_id != current_user.id or not task.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit task not found")
    checked = toggle_checkin(db, pair, current_user, task, target_date)
    db.commit()
    db.refresh(task)
    return HabitToggleOut(
        date=target_date,
        task=HabitTaskOut.model_validate(task),
        checked=checked,
        dashboard=build_dashboard(db, pair, start, end),
    )
