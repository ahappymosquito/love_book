"""Pair-level cycle mail reminder: settings, the send window, and the daily morning scan.

One partner turns it on and picks who receives it (default: the other partner) and how many days ahead.
Each morning the scan mails the recipient once per predicted period start while today falls in
[next_period_start - days_before, next_period_start). Predictions come live from app.cycles; nothing is stored
except the dedupe row in cycle_reminder_runs. Copy stays gentle and never gives medical advice.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
import logging

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cycles import predicted_stats
from app.emailer import notify_cycle_reminder
from app.models import CycleReminderRun, CycleReminderSetting, Pair, User
from app.schemas import CycleReminderSettingOut, CycleReminderSettingUpdate
from app.services import active_token_for_user, counterpart

logger = logging.getLogger(__name__)

DEFAULT_DAYS_BEFORE = 3
REMINDER_TIME = time(hour=9, minute=0)


def _now() -> datetime:
    return datetime.now().astimezone()


def due_period_start(next_period_start: date | None, days_before: int, today: date) -> date | None:
    if next_period_start is None:
        return None
    if next_period_start - timedelta(days=days_before) <= today < next_period_start:
        return next_period_start
    return None


def _already_sent(db: Session, pair_id: int, period_start: date) -> bool:
    return (
        db.execute(
            select(CycleReminderRun.id).where(CycleReminderRun.pair_id == pair_id, CycleReminderRun.period_start == period_start)
        ).first()
        is not None
    )


def _next_send_on(db: Session, pair: Pair, next_period_start: date | None, days_before: int, now: datetime) -> date | None:
    if next_period_start is None or _already_sent(db, pair.id, next_period_start):
        return None
    today = now.date()
    send_on = max(next_period_start - timedelta(days=days_before), today)
    if send_on == today and now.time() >= REMINDER_TIME:
        send_on = today + timedelta(days=1)
    return send_on if send_on < next_period_start else None


def get_setting(db: Session, pair: Pair) -> CycleReminderSetting | None:
    return db.execute(select(CycleReminderSetting).where(CycleReminderSetting.pair_id == pair.id)).scalar_one_or_none()


def setting_out(db: Session, pair: Pair, user: User, now: datetime | None = None) -> CycleReminderSettingOut:
    now = now or _now()
    setting = get_setting(db, pair)
    recipient_id = setting.recipient_user_id if setting else counterpart(pair, user).id
    recipient = db.get(User, recipient_id)
    enabled = bool(setting and setting.enabled)
    days_before = setting.days_before if setting else DEFAULT_DAYS_BEFORE
    stats = predicted_stats(db, pair, now.date())
    next_start = stats.next_period_start if stats.has_prediction else None
    return CycleReminderSettingOut(
        enabled=enabled,
        days_before=days_before,
        recipient_user_id=recipient_id,
        recipient_has_email=bool(recipient and recipient.email),
        updated_by_id=setting.updated_by_id if setting else None,
        updated_at=setting.updated_at if setting else None,
        next_period_start=next_start,
        next_send_on=_next_send_on(db, pair, next_start, days_before, now) if enabled else None,
    )


def update_setting(db: Session, pair: Pair, user: User, payload: CycleReminderSettingUpdate) -> CycleReminderSetting:
    recipient_id = payload.recipient_user_id or counterpart(pair, user).id
    if recipient_id not in {pair.user_a_id, pair.user_b_id}:
        raise HTTPException(status_code=422, detail="提醒只能发给你们两个人中的一位")
    setting = get_setting(db, pair)
    if setting is None:
        setting = CycleReminderSetting(pair_id=pair.id, recipient_user_id=recipient_id, updated_by_id=user.id)
        db.add(setting)
    setting.enabled = payload.enabled
    setting.days_before = payload.days_before
    setting.recipient_user_id = recipient_id
    setting.updated_by_id = user.id
    db.commit()
    db.refresh(setting)
    return setting


def scan_cycle_reminders(db: Session, today: date) -> int:
    settings = db.execute(select(CycleReminderSetting).where(CycleReminderSetting.enabled.is_(True))).scalars().all()
    sent = 0
    for setting in settings:
        pair = db.get(Pair, setting.pair_id)
        if pair is None or pair.dissolved_at is not None:
            continue
        recipient = db.get(User, setting.recipient_user_id)
        if recipient is None or recipient.id not in {pair.user_a_id, pair.user_b_id} or not recipient.email:
            continue
        stats = predicted_stats(db, pair, today)
        period_start = due_period_start(stats.next_period_start if stats.has_prediction else None, setting.days_before, today)
        if period_start is None or _already_sent(db, pair.id, period_start):
            continue
        try:
            delivered = notify_cycle_reminder(
                recipient_email=recipient.email,
                recipient_name=recipient.display_name,
                recipient_token=active_token_for_user(db, recipient.id),
                period_start=period_start,
                days_left=(period_start - today).days,
            )
            if not delivered:
                continue
            db.add(CycleReminderRun(pair_id=pair.id, recipient_user_id=recipient.id, period_start=period_start))
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Cycle reminder failed for pair %s", pair.id)
            continue
        sent += 1
    return sent


def seconds_until_next_cycle_reminder(now: datetime | None = None) -> float:
    current = now or _now()
    target = datetime.combine(current.date(), REMINDER_TIME, tzinfo=current.tzinfo)
    if current >= target:
        target = target + timedelta(days=1)
    return max(1.0, (target - current).total_seconds())
