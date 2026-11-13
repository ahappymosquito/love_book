"""Pair journal (手账) export route; read-only, same-pair Bearer auth, closed pairs blocked like other routes."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.database import get_db
from app.journal import build_journal
from app.models import User
from app.schemas import JournalOut

router = APIRouter(prefix="/journal", tags=["journal"])


@router.get("", response_model=JournalOut)
def get_journal(
    scope: Literal["all", "range", "meeting"] = Query(default="all"),
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    meeting_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JournalOut:
    pair = get_pair_for_user(db, current_user.id)
    return build_journal(db, pair, current_user, scope=scope, start=start, end=end, meeting_id=meeting_id)
