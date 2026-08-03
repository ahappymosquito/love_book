"""Anonymous global runner leaderboard routes that retain only the best ten scores."""

from threading import Lock

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import GameScore
from app.schemas import GameScoreCreate, GameScoreOut, LeaderboardOut, LeaderboardSubmitOut

router = APIRouter(prefix="/game", tags=["game"])
_leaderboard_write_lock = Lock()


def _ordered_scores(db: Session, limit: int = 10) -> list[GameScore]:
    return list(
        db.execute(
            select(GameScore)
            .order_by(GameScore.score.desc(), GameScore.created_at.asc(), GameScore.id.asc())
            .limit(limit)
        ).scalars()
    )


def _threshold(items: list[GameScore]) -> int:
    return items[-1].score if len(items) >= 10 else 0


@router.get("/leaderboard", response_model=LeaderboardOut)
def read_leaderboard(db: Session = Depends(get_db)) -> LeaderboardOut:
    items = _ordered_scores(db)
    return LeaderboardOut(
        items=[GameScoreOut.model_validate(item) for item in items],
        threshold=_threshold(items),
    )


@router.post("/leaderboard", response_model=LeaderboardSubmitOut, status_code=status.HTTP_201_CREATED)
def submit_score(payload: GameScoreCreate, db: Session = Depends(get_db)) -> LeaderboardSubmitOut:
    with _leaderboard_write_lock:
        current = _ordered_scores(db)
        if len(current) >= 10 and payload.score < current[-1].score:
            return LeaderboardSubmitOut(
                entered=False,
                rank=None,
                items=[GameScoreOut.model_validate(item) for item in current],
                threshold=_threshold(current),
            )

        submitted = GameScore(player_name=payload.player_name, score=payload.score)
        db.add(submitted)
        db.flush()
        ranked = _ordered_scores(db, limit=11)
        top_ten = ranked[:10]
        kept_ids = [item.id for item in top_ten]
        db.execute(delete(GameScore).where(GameScore.id.not_in(kept_ids)))
        entered = submitted.id in kept_ids
        rank = next((index + 1 for index, item in enumerate(top_ten) if item.id == submitted.id), None)
        db.commit()
    return LeaderboardSubmitOut(
        entered=entered,
        rank=rank,
        items=[GameScoreOut.model_validate(item) for item in top_ten],
        threshold=_threshold(top_ten),
    )
