import secrets
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import require_admin_key
from app.core.database import get_db
from app.models import DeviceToken, Pair, User, utc_now
from app.schemas import PairCreate, PairCreated, PairOut

router = APIRouter(prefix="/admin", tags=["admin"])


def normalize_token_expires_at(expires_at):
    if expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    else:
        expires_at = expires_at.astimezone(timezone.utc)
    if expires_at <= utc_now():
        raise HTTPException(status_code=422, detail="Token expiration must be in the future")
    return expires_at


def pair_out(db: Session, pair: Pair) -> PairOut:
    tokens = db.execute(
        select(DeviceToken).where(DeviceToken.user_id.in_([pair.user_a_id, pair.user_b_id]))
    ).scalars()
    token_by_user_id = {token.user_id: token for token in tokens}
    user_a_token = token_by_user_id.get(pair.user_a_id)
    user_b_token = token_by_user_id.get(pair.user_b_id)
    return PairOut(
        pair_id=pair.id,
        user_a=pair.user_a,
        user_b=pair.user_b,
        user_a_token=user_a_token.token if user_a_token else "",
        user_b_token=user_b_token.token if user_b_token else "",
        user_a_token_expires_at=user_a_token.expires_at if user_a_token else None,
        user_b_token_expires_at=user_b_token.expires_at if user_b_token else None,
        created_at=pair.created_at,
    )


@router.get("/pairs", response_model=list[PairOut], dependencies=[Depends(require_admin_key)])
def list_pairs(db: Session = Depends(get_db)) -> list[PairOut]:
    pairs = db.execute(select(Pair).order_by(Pair.created_at.desc())).scalars().all()
    return [pair_out(db, pair) for pair in pairs]


@router.post("/pairs", response_model=PairCreated, dependencies=[Depends(require_admin_key)])
def create_pair(payload: PairCreate, db: Session = Depends(get_db)) -> PairCreated:
    token_expires_at = normalize_token_expires_at(payload.token_expires_at)
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
            DeviceToken(token=user_a_token, user_id=user_a.id, expires_at=token_expires_at),
            DeviceToken(token=user_b_token, user_id=user_b.id, expires_at=token_expires_at),
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
        user_a_token_expires_at=token_expires_at,
        user_b_token_expires_at=token_expires_at,
    )
