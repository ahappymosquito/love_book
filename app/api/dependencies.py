"""Bearer 鉴权、管理密钥校验，以及已合上手账时返回给登录方的 410 告别信息。"""

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models import DeviceToken, Pair, User, utc_now

bearer_scheme = HTTPBearer(auto_error=False)
DEFAULT_FAREWELL_MESSAGE = "我们已经把这本手账合上了。"


def token_is_expired(token: DeviceToken) -> bool:
    if token.expires_at is None:
        return False
    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utc_now().tzinfo)
    return expires_at <= utc_now()


def require_admin_key(x_admin_key: str | None = Header(default=None)) -> None:
    if not x_admin_key or x_admin_key != get_settings().admin_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin key")


def pair_dissolved_detail(pair: Pair) -> dict[str, str]:
    message = (pair.farewell_message or "").strip() or DEFAULT_FAREWELL_MESSAGE
    from_name = ""
    if pair.dissolved_by_user_id == pair.user_a_id:
        from_name = pair.user_a.display_name
    elif pair.dissolved_by_user_id == pair.user_b_id:
        from_name = pair.user_b.display_name
    return {
        "code": "pair_dissolved",
        "message": message,
        "from_display_name": from_name,
    }


def raise_if_pair_dissolved(pair: Pair) -> None:
    if pair.dissolved_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=pair_dissolved_detail(pair))


def find_pair_for_user(db: Session, user_id: int) -> Pair | None:
    return db.execute(
        select(Pair).where(or_(Pair.user_a_id == user_id, Pair.user_b_id == user_id))
    ).scalar_one_or_none()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = db.get(DeviceToken, credentials.credentials)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if token_is_expired(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.get(User, token.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token")
    pair = find_pair_for_user(db, user.id)
    if pair is not None:
        raise_if_pair_dissolved(pair)
    return user


def get_pair_for_user(db: Session, user_id: int) -> Pair:
    pair = find_pair_for_user(db, user_id)
    if pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pair not found")
    raise_if_pair_dissolved(pair)
    return pair
