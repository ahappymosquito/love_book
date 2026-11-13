"""Admin login check: constant-time admin key comparison, refused in production while the placeholder key is set."""

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import admin_key_matches, ensure_admin_key_configured
from app.schemas import AdminAuthRequest, AdminAuthResponse

router = APIRouter(prefix="/admin", tags=["admin-auth"])


@router.post("/auth", response_model=AdminAuthResponse)
def verify_admin_key(payload: AdminAuthRequest) -> AdminAuthResponse:
    ensure_admin_key_configured()
    if not admin_key_matches(payload.admin_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin key",
        )
    return AdminAuthResponse(ok=True)
