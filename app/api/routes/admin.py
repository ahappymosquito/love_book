import secrets

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import require_admin_key
from app.core.database import get_db
from app.models import DeviceToken, Pair, User
from app.schemas import PairCreate, PairCreated, PairOut

router = APIRouter(prefix="/admin", tags=["admin"])


def pair_out(db: Session, pair: Pair) -> PairOut:
    tokens = db.execute(
        select(DeviceToken).where(DeviceToken.user_id.in_([pair.user_a_id, pair.user_b_id]))
    ).scalars()
    token_by_user_id = {token.user_id: token.token for token in tokens}
    return PairOut(
        pair_id=pair.id,
        user_a=pair.user_a,
        user_b=pair.user_b,
        user_a_token=token_by_user_id.get(pair.user_a_id, ""),
        user_b_token=token_by_user_id.get(pair.user_b_id, ""),
        created_at=pair.created_at,
    )


@router.get("/pairs", response_model=list[PairOut], dependencies=[Depends(require_admin_key)])
def list_pairs(db: Session = Depends(get_db)) -> list[PairOut]:
    pairs = db.execute(select(Pair).order_by(Pair.created_at.desc())).scalars().all()
    return [pair_out(db, pair) for pair in pairs]


@router.post("/pairs", response_model=PairCreated, dependencies=[Depends(require_admin_key)])
def create_pair(payload: PairCreate, db: Session = Depends(get_db)) -> PairCreated:
    user_a = User(display_name=payload.user_a_display_name, avatar=payload.user_a_avatar or "")
    user_b = User(display_name=payload.user_b_display_name, avatar=payload.user_b_avatar or "")
    db.add_all([user_a, user_b])
    db.flush()

    pair = Pair(user_a_id=user_a.id, user_b_id=user_b.id)
    user_a_token = secrets.token_urlsafe(32)
    user_b_token = secrets.token_urlsafe(32)
    db.add_all(
        [
            pair,
            DeviceToken(token=user_a_token, user_id=user_a.id),
            DeviceToken(token=user_b_token, user_id=user_b.id),
        ]
    )
    db.flush()
    db.refresh(pair)
    return PairCreated(
        pair_id=pair.id,
        user_a=user_a,
        user_b=user_b,
        user_a_token=user_a_token,
        user_b_token=user_b_token,
    )
