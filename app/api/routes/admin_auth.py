from fastapi import APIRouter, HTTPException, status

from app.core.config import get_settings
from app.schemas import AdminAuthRequest, AdminAuthResponse

router = APIRouter(prefix="/admin", tags=["admin-auth"])


@router.post("/auth", response_model=AdminAuthResponse)
def verify_admin_key(payload: AdminAuthRequest) -> AdminAuthResponse:
    if payload.admin_key != get_settings().admin_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin key",
        )
    return AdminAuthResponse(ok=True)
