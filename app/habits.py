"""Habit services for pair-visible tasks, daily dashboards, check-ins, and delivery-aware reminder scans."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.emailer import notify_habit_reminder
from app.models import DeviceToken, HabitCheckin, HabitReminderRun, HabitTask, Pair, User, utc_now
from app.schemas import HabitDashboardOut, HabitDayOut, HabitTaskOut, HabitUserDayOut


def dates_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def pair_users(pair: Pair) -> list[User]:
    return [pair.user_a, pair.user_b]


def next_sort_order(db: Session, pair: Pair, owner: User) -> int:
    current = db.execute(
        select(func.max(HabitTask.sort_order)).where(HabitTask.pair_id == pair.id, HabitTask.owner_id == owner.id)
    ).scalar_one_or_none()
    return int(current or 0) + 1


def build_dashboard(db: Session, pair: Pair, start: date, end: date) -> HabitDashboardOut:
    users = pair_users(pair)
    tasks = (
        db.execute(
            select(HabitTask)
            .where(HabitTask.pair_id == pair.id, HabitTask.is_active.is_(True))
            .order_by(HabitTask.owner_id, HabitTask.sort_order, HabitTask.id)
        )
        .scalars()
        .all()
    )
    task_ids = [task.id for task in tasks]
    checkins = []
    if task_ids:
        checkins = (
            db.execute(
                select(HabitCheckin).where(
                    HabitCheckin.pair_id == pair.id,
                    HabitCheckin.date >= start,
                    HabitCheckin.date <= end,
                    HabitCheckin.habit_id.in_(task_ids),
                )
            )
            .scalars()
            .all()
        )
    completed_by_date_user: dict[tuple[date, int], set[int]] = {}
    for checkin in checkins:
        completed_by_date_user.setdefault((checkin.date, checkin.user_id), set()).add(checkin.habit_id)

    tasks_by_user: dict[int, list[HabitTask]] = {user.id: [] for user in users}
    for task in tasks:
        tasks_by_user.setdefault(task.owner_id, []).append(task)

    days: list[HabitDayOut] = []
    for day in dates_between(start, end):
        user_days: list[HabitUserDayOut] = []
        for user in users:
            user_tasks = tasks_by_user.get(user.id, [])
            completed_ids = sorted(completed_by_date_user.get((day, user.id), set()))
            completed_ids = [task_id for task_id in completed_ids if any(task.id == task_id for task in user_tasks)]
            total = len(user_tasks)
            completed = len(completed_ids)
            user_days.append(
                HabitUserDayOut(
                    user_id=user.id,
                    display_name=user.display_name,
                    tasks_total=total,
                    completed_count=completed,
                    all_completed=total > 0 and completed == total,
                    completed_task_ids=completed_ids,
                )
            )
        days.append(
            HabitDayOut(
                date=day,
                users=user_days,
                pair_all_completed=all(item.all_completed for item in user_days if item.tasks_total > 0)
                and any(item.tasks_total > 0 for item in user_days),
            )
        )

    return HabitDashboardOut(
        start=start,
        end=end,
        tasks=[HabitTaskOut.model_validate(task) for task in tasks],
        days=days,
    )


def ensure_pair_habit(db: Session, pair: Pair, habit_id: int) -> HabitTask | None:
    habit = db.get(HabitTask, habit_id)
    if habit is None or habit.pair_id != pair.id:
        return None
    return habit


def toggle_checkin(db: Session, pair: Pair, user: User, habit: HabitTask, target_date: date) -> bool:
    existing = db.execute(
        select(HabitCheckin).where(
            HabitCheckin.pair_id == pair.id,
            HabitCheckin.habit_id == habit.id,
            HabitCheckin.user_id == user.id,
            HabitCheckin.date == target_date,
        )
    ).scalar_one_or_none()
    if existing:
        db.delete(existing)
        db.flush()
        return False
    db.add(HabitCheckin(pair_id=pair.id, habit_id=habit.id, user_id=user.id, date=target_date))
    db.flush()
    return True


def completion_for_user(db: Session, pair: Pair, user: User, target_date: date) -> tuple[int, int, bool]:
    habits = (
        db.execute(
            select(HabitTask.id).where(
                HabitTask.pair_id == pair.id,
                HabitTask.owner_id == user.id,
                HabitTask.is_active.is_(True),
            )
        )
        .scalars()
        .all()
    )
    total = len(habits)
    if not total:
        return 0, 0, True
    completed = db.execute(
        select(func.count(HabitCheckin.id)).where(
            HabitCheckin.pair_id == pair.id,
            HabitCheckin.user_id == user.id,
            HabitCheckin.date == target_date,
            HabitCheckin.habit_id.in_(habits),
        )
    ).scalar_one()
    return total, int(completed), int(completed) == total


def active_token_for_user(db: Session, user_id: int) -> str | None:
    now = utc_now()
    token = (
        db.execute(
            select(DeviceToken)
            .where(
                DeviceToken.user_id == user_id,
                or_(DeviceToken.expires_at.is_(None), DeviceToken.expires_at > now),
            )
            .order_by(DeviceToken.created_at.desc())
        )
        .scalars()
        .first()
    )
    return token.token if token else None


def scan_habit_reminders(db: Session, target_date: date) -> int:
    pairs = db.execute(select(Pair)).scalars().all()
    sent = 0
    for pair in pairs:
        for user in pair_users(pair):
            if not user.email:
                continue
            already_sent = db.execute(
                select(HabitReminderRun.id).where(
                    HabitReminderRun.user_id == user.id,
                    HabitReminderRun.date == target_date,
                )
            ).first()
            if already_sent:
                continue
            total, completed, all_done = completion_for_user(db, pair, user, target_date)
            if total == 0 or all_done:
                continue
            delivered = notify_habit_reminder(
                recipient_email=user.email,
                recipient_name=user.display_name,
                recipient_token=active_token_for_user(db, user.id),
                target_date=target_date,
                total_count=total,
                completed_count=completed,
            )
            if not delivered:
                continue
            db.add(HabitReminderRun(pair_id=pair.id, user_id=user.id, date=target_date))
            sent += 1
    db.commit()
    return sent


def seconds_until_next_reminder(now: datetime | None = None) -> float:
    current = now or datetime.now().astimezone()
    target = datetime.combine(current.date(), time(hour=0, minute=1), tzinfo=current.tzinfo)
    if current >= target:
        target = target + timedelta(days=1)
    return max(1.0, (target - current).total_seconds())


def reminder_target_date(now: datetime | None = None) -> date:
    current = now or datetime.now().astimezone()
    return current.date() - timedelta(days=1)
