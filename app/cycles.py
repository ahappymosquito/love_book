"""Cycle record persistence, fact-only log storage, and weighted live predictions.

Only period segments of 2-10 days anchor a cycle start (a segment still touching yesterday is only held to
the 10-day cap). Without any anchor the dashboard returns no prediction: stats date fields are null and
unrecorded days stay empty instead of being fabricated.
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CycleDailyLog, CyclePhase, Pair, User
from app.schemas import CycleDailyLogOut, CycleDailyLogUpsert, CycleDashboardOut, CycleStats

DEFAULT_CYCLE_LENGTH = 28
DEFAULT_PERIOD_LENGTH = 5
MIN_REASONABLE_CYCLE_LENGTH = 21
MAX_REASONABLE_CYCLE_LENGTH = 45
MIN_REASONABLE_PERIOD_LENGTH = 2
MAX_REASONABLE_PERIOD_LENGTH = 10
RECENT_CYCLE_LIMIT = 6
RECENT_WEIGHTED_LIMIT = 3


def local_today() -> date:
    return date.today()


def _date_range(start: date, end: date) -> list[date]:
    days = (end - start).days
    if days < 0:
        return []
    return [start + timedelta(days=i) for i in range(days + 1)]


def _period_segments(logs: list[CycleDailyLog]) -> list[tuple[date, int]]:
    segments: list[tuple[date, int]] = []
    for day in sorted({log.date for log in logs if log.is_period}):
        if segments and (day - segments[-1][0]).days == segments[-1][1]:
            segments[-1] = (segments[-1][0], segments[-1][1] + 1)
        else:
            segments.append((day, 1))
    return segments


def _period_starts(logs: list[CycleDailyLog], today: date) -> list[date]:
    starts: list[date] = []
    for start, length in _period_segments(logs):
        # A segment touching yesterday or later may still be growing, so only the upper bound applies to it.
        ongoing = start + timedelta(days=length) >= today
        if length > MAX_REASONABLE_PERIOD_LENGTH:
            continue
        if length < MIN_REASONABLE_PERIOD_LENGTH and not ongoing:
            continue
        starts.append(start)
    return starts


def _period_lengths(logs: list[CycleDailyLog]) -> list[int]:
    return [length for _, length in _period_segments(logs)]


def _mean_int(values: list[int], fallback: int) -> int:
    if not values:
        return fallback
    return max(1, round(sum(values) / len(values)))


def _reasonable_values(values: list[int], minimum: int, maximum: int) -> list[int]:
    return [value for value in values if minimum <= value <= maximum]


def _cycle_lengths(starts: list[date]) -> list[int]:
    lengths = [(right - left).days for left, right in zip(starts, starts[1:]) if (right - left).days > 0]
    return _reasonable_values(lengths, MIN_REASONABLE_CYCLE_LENGTH, MAX_REASONABLE_CYCLE_LENGTH)


def _weighted_recent_mean(values: list[int], fallback: int) -> int:
    recent = values[-RECENT_CYCLE_LIMIT:]
    if not recent:
        return fallback
    weighted_total = 0
    weight_total = 0
    weighted_start = max(0, len(recent) - RECENT_WEIGHTED_LIMIT)
    for index, value in enumerate(recent):
        weight = 2 if index >= weighted_start else 1
        weighted_total += value * weight
        weight_total += weight
    return max(1, round(weighted_total / weight_total))


def _recent_period_length(logs: list[CycleDailyLog]) -> int:
    lengths = _reasonable_values(
        _period_lengths(logs),
        MIN_REASONABLE_PERIOD_LENGTH,
        MAX_REASONABLE_PERIOD_LENGTH,
    )
    return _mean_int(lengths[-RECENT_CYCLE_LIMIT:], DEFAULT_PERIOD_LENGTH)


def _confidence(lengths: list[int]) -> tuple[str, int]:
    if not lengths:
        return "low", 0
    recent = lengths[-RECENT_CYCLE_LIMIT:]
    variation = max(recent) - min(recent)
    if len(recent) >= 4 and variation <= 3:
        return "high", variation
    if len(recent) >= 2 and variation <= 7:
        return "medium", variation
    return "low", variation


def _phase_for_cycle_day(day_index: int, cycle_length: int, period_length: int) -> CyclePhase:
    ovulation_index = max(period_length + 1, cycle_length - 14)
    fertile_start = max(period_length, ovulation_index - 5)
    if day_index < period_length:
        return CyclePhase.menstrual
    if day_index == ovulation_index:
        return CyclePhase.ovulation
    if fertile_start <= day_index < ovulation_index:
        return CyclePhase.fertile
    if day_index < fertile_start:
        return CyclePhase.follicular
    return CyclePhase.luteal


def _normalize_log_data(data: dict[str, object]) -> dict[str, object]:
    data["phase"] = CyclePhase.menstrual if data.get("is_period") else CyclePhase.unknown
    data["is_predicted"] = False
    return data


def _stats(all_logs: list[CycleDailyLog], starts: list[date], today: date) -> CycleStats:
    lengths = _cycle_lengths(starts)
    average_cycle = _weighted_recent_mean(lengths, DEFAULT_CYCLE_LENGTH)
    average_period = _recent_period_length(all_logs)
    confidence, variation = _confidence(lengths)

    if not starts:
        return CycleStats(
            has_prediction=False,
            current_cycle_day=None,
            current_phase=CyclePhase.unknown,
            average_cycle_length=average_cycle,
            average_period_length=average_period,
            last_period_start=None,
            next_period_start=None,
            next_period_end=None,
            ovulation_date=None,
            fertile_start=None,
            fertile_end=None,
            confidence="low",
            prediction_start=None,
            prediction_end=None,
            cycle_variation_days=0,
        )

    last_start = max((start for start in starts if start <= today), default=None)
    if last_start is None:
        last_start = starts[-1]
        while last_start > today:
            last_start -= timedelta(days=average_cycle)

    next_start = last_start + timedelta(days=average_cycle)
    while next_start < today:
        last_start = next_start
        next_start = last_start + timedelta(days=average_cycle)

    next_end = next_start + timedelta(days=max(average_period - 1, 0))
    ovulation = next_start - timedelta(days=14)
    fertile_start = ovulation - timedelta(days=5)
    fertile_end = ovulation
    uncertainty = 0 if confidence == "high" else 2 if confidence == "medium" else 4
    cycle_day = max(1, (today - last_start).days + 1)
    current_phase = _phase_for_cycle_day((today - last_start).days % average_cycle, average_cycle, average_period)

    return CycleStats(
        has_prediction=True,
        current_cycle_day=cycle_day,
        current_phase=current_phase,
        average_cycle_length=average_cycle,
        average_period_length=average_period,
        last_period_start=last_start,
        next_period_start=next_start,
        next_period_end=next_end,
        ovulation_date=ovulation,
        fertile_start=fertile_start,
        fertile_end=fertile_end,
        confidence=confidence,  # type: ignore[arg-type]
        prediction_start=next_start - timedelta(days=uncertainty),
        prediction_end=next_start + timedelta(days=uncertainty),
        cycle_variation_days=variation,
    )


def _predicted_log(day: date, stats: CycleStats) -> CycleDailyLogOut:
    if stats.next_period_start <= day <= stats.next_period_end:
        phase = CyclePhase.predicted_period
        is_period = True
    elif day == stats.ovulation_date:
        phase = CyclePhase.ovulation
        is_period = False
    elif stats.fertile_start <= day <= stats.fertile_end:
        phase = CyclePhase.fertile
        is_period = False
    else:
        distance = (day - stats.last_period_start).days
        phase = _phase_for_cycle_day(distance % stats.average_cycle_length, stats.average_cycle_length, stats.average_period_length)
        is_period = phase == CyclePhase.menstrual
    return CycleDailyLogOut(
        date=day,
        phase=phase,
        is_period=is_period,
        is_predicted=True,
        flow=None,
        symptoms=[],
        mood=None,
        bbt=None,
        cervical_mucus=None,
        note=None,
        updated_by_id=None,
        updated_at=None,
        source="predicted",
    )


def _anchor_for_day(day: date, starts: list[date], stats: CycleStats) -> date:
    return max((start for start in starts if start <= day), default=stats.last_period_start)


def _non_period_phase(day: date, starts: list[date], stats: CycleStats) -> CyclePhase:
    anchor = _anchor_for_day(day, starts, stats)
    distance = (day - anchor).days
    phase = _phase_for_cycle_day(
        distance % stats.average_cycle_length,
        stats.average_cycle_length,
        stats.average_period_length,
    )
    return CyclePhase.follicular if phase == CyclePhase.menstrual else phase


def _empty_log(day: date) -> CycleDailyLogOut:
    return CycleDailyLogOut(
        date=day,
        phase=CyclePhase.unknown,
        is_period=False,
        is_predicted=False,
        flow=None,
        symptoms=[],
        mood=None,
        bbt=None,
        cervical_mucus=None,
        note=None,
        updated_by_id=None,
        updated_at=None,
        source="empty",
    )


def _past_non_period_log(day: date, starts: list[date], stats: CycleStats) -> CycleDailyLogOut:
    return CycleDailyLogOut(
        date=day,
        phase=_non_period_phase(day, starts, stats),
        is_period=False,
        is_predicted=True,
        flow=None,
        symptoms=[],
        mood=None,
        bbt=None,
        cervical_mucus=None,
        note=None,
        updated_by_id=None,
        updated_at=None,
        source="predicted",
    )


def _log_out(log: CycleDailyLog) -> CycleDailyLogOut:
    phase = CyclePhase.menstrual if log.is_period else log.phase
    return CycleDailyLogOut(
        date=log.date,
        phase=phase,
        is_period=log.is_period,
        is_predicted=log.is_predicted,
        flow=log.flow,
        symptoms=list(log.symptoms or []),
        mood=log.mood,
        bbt=log.bbt,
        cervical_mucus=log.cervical_mucus,
        note=log.note,
        updated_by_id=log.updated_by_id,
        updated_at=log.updated_at,
        source="recorded",
    )


def _recorded_dashboard_log(log: CycleDailyLog, starts: list[date], stats: CycleStats) -> CycleDailyLogOut:
    output = _log_out(log)
    if not log.is_period and starts:
        output.phase = _non_period_phase(log.date, starts, stats)
    return output


def _dashboard_log(
    day: date,
    today: date,
    range_logs: dict[date, CycleDailyLog],
    starts: list[date],
    stats: CycleStats,
) -> CycleDailyLogOut:
    if day in range_logs:
        return _recorded_dashboard_log(range_logs[day], starts, stats)
    if not stats.has_prediction:
        return _empty_log(day)
    if day >= today:
        return _predicted_log(day, stats)
    return _past_non_period_log(day, starts, stats)


def dashboard(db: Session, pair: Pair, start: date, end: date, today: date | None = None) -> CycleDashboardOut:
    today = today or local_today()
    all_logs = db.execute(
        select(CycleDailyLog).where(CycleDailyLog.pair_id == pair.id).order_by(CycleDailyLog.date)
    ).scalars().all()
    range_logs = {log.date: log for log in all_logs if start <= log.date <= end}
    starts = _period_starts(all_logs, today)
    stats = _stats(all_logs, starts, today)
    logs = [_dashboard_log(day, today, range_logs, starts, stats) for day in _date_range(start, end)]
    return CycleDashboardOut(logs=logs, stats=stats, is_empty=len(all_logs) == 0)


def upsert_log(db: Session, pair: Pair, user: User, day: date, payload: CycleDailyLogUpsert) -> CycleDailyLog:
    log = db.execute(
        select(CycleDailyLog).where(CycleDailyLog.pair_id == pair.id, CycleDailyLog.date == day)
    ).scalar_one_or_none()
    data = _normalize_log_data(payload.model_dump())
    if log is None:
        log = CycleDailyLog(pair_id=pair.id, date=day, created_by_id=user.id, updated_by_id=user.id, **data)
        db.add(log)
    else:
        for field, value in data.items():
            setattr(log, field, value)
        log.updated_by_id = user.id
    db.commit()
    db.refresh(log)
    return log


def delete_log(db: Session, pair: Pair, day: date) -> bool:
    log = db.execute(
        select(CycleDailyLog).where(CycleDailyLog.pair_id == pair.id, CycleDailyLog.date == day)
    ).scalar_one_or_none()
    if log is None:
        return False
    db.delete(log)
    db.commit()
    return True
