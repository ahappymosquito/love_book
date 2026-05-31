"""User media routes for private avatar image downloads with pair or admin authorization."""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.dependencies import bearer_scheme, get_pair_for_user, token_is_expired
from app.core.config import get_settings
from app.core.database import get_db
from app.models import DeviceToken, User
from app.storage import PRIVATE_MEDIA_CACHE_HEADERS, MediaStorageError, read_media_file

router = APIRouter(prefix="/users", tags=["users"])


def _authorized_for_avatar(
    db: Session,
    target_user_id: int,
    credentials: HTTPAuthorizationCredentials | None,
    admin_key: str | None,
) -> bool:
    if admin_key and admin_key == get_settings().admin_key:
        return True
    if credentials is None or credentials.scheme.lower() != "bearer":
        return False
    token = db.get(DeviceToken, credentials.credentials)
    if token is None or token_is_expired(token):
        return False
    if token.user_id == target_user_id:
        return True
    pair = get_pair_for_user(db, token.user_id)
    return target_user_id in {pair.user_a_id, pair.user_b_id}


@router.get("/{user_id}/avatar")
def get_user_avatar(
    user_id: int,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_admin_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None or not user.avatar_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar image not found")
    if not _authorized_for_avatar(db, user_id, credentials, x_admin_key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar image not found")
    try:
        stored = read_media_file(user.avatar_storage_key)
    except MediaStorageError as exc:
        raise HTTPException(status_code=500, detail=f"Avatar image could not be read: {exc}") from exc
    if stored is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar image not found")
    return Response(
        content=stored,
        media_type=user.avatar_mime_type or "image/jpeg",
        headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
    )
