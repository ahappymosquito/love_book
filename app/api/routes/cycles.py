"""Authenticated cycle dashboard routes for shared pair cycle logs and live reference-only predictions."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.cycles import dashboard, delete_log, seed_example_data, upsert_log, clear_logs
from app.models import User
from app.schemas import CycleDailyLogOut, CycleDailyLogUpsert, CycleDashboardOut

router = APIRouter(prefix="/cycles", tags=["cycles"])


def _validate_dashboard_range(start: date, end: date) -> None:
    if end < start:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end must be on or after start")
    if (end - start).days > 120:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date range is too large")


@router.get("/dashboard", response_model=CycleDashboardOut)
def read_cycle_dashboard(
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CycleDashboardOut:
    _validate_dashboard_range(start, end)
    pair = get_pair_for_user(db, current_user.id)
    return dashboard(db, pair, start, end)


@router.put("/logs/{day}", response_model=CycleDailyLogOut)
def put_cycle_log(
    day: date,
    payload: CycleDailyLogUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CycleDailyLogOut:
    pair = get_pair_for_user(db, current_user.id)
    log = upsert_log(db, pair, current_user, day, payload)
    return CycleDailyLogOut.model_validate(
        {
            "date": log.date,
            "phase": log.phase,
            "is_period": log.is_period,
            "is_predicted": log.is_predicted,
            "flow": log.flow,
            "symptoms": log.symptoms or [],
            "mood": log.mood,
            "bbt": log.bbt,
            "cervical_mucus": log.cervical_mucus,
            "note": log.note,
            "updated_by_id": log.updated_by_id,
            "updated_at": log.updated_at,
            "source": "recorded",
        }
    )


@router.put("/logs/{day}/dashboard", response_model=CycleDashboardOut)
def put_cycle_log_and_read_dashboard(
    day: date,
    start: date,
    end: date,
    payload: CycleDailyLogUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CycleDashboardOut:
    _validate_dashboard_range(start, end)
    pair = get_pair_for_user(db, current_user.id)
    upsert_log(db, pair, current_user, day, payload)
    return dashboard(db, pair, start, end)


@router.delete("/logs/{day}", status_code=status.HTTP_204_NO_CONTENT)
def remove_cycle_log(
    day: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    delete_log(db, pair, day)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/logs", status_code=status.HTTP_204_NO_CONTENT)
def remove_cycle_logs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    pair = get_pair_for_user(db, current_user.id)
    clear_logs(db, pair)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/example-data", response_model=list[CycleDailyLogOut], status_code=status.HTTP_201_CREATED)
def create_cycle_example_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CycleDailyLogOut]:
    pair = get_pair_for_user(db, current_user.id)
    logs = seed_example_data(db, pair, current_user)
    return [
        CycleDailyLogOut.model_validate(
            {
                "date": log.date,
                "phase": log.phase,
                "is_period": log.is_period,
                "is_predicted": log.is_predicted,
                "flow": log.flow,
                "symptoms": log.symptoms or [],
                "mood": log.mood,
                "bbt": log.bbt,
                "cervical_mucus": log.cervical_mucus,
                "note": log.note,
                "updated_by_id": log.updated_by_id,
                "updated_at": log.updated_at,
                "source": "recorded",
            }
        )
        for log in logs
    ]
