"""User auth/profile routes including entry tokens, Argon2id password sessions, avatars, and reminders."""

from datetime import datetime, timedelta
import secrets
import unicodedata

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import amap_mcp
from app.ai_config import effective_amap_key
from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.login_logs import client_ip, enrich_location, record_login
from app.media import MediaProcessingError, make_avatar_image
from app.models import DeviceToken, User, utc_now
from app.schemas import (
    AnniversaryOut,
    LoginLogOut,
    LoginRecordCreate,
    MeLocationUpdate,
    MeOut,
    MeUpdate,
    PasswordLoginIn,
    PasswordSessionOut,
    SecurityPasswordOut,
    SecurityPasswordUpdateIn,
    SecurityPasswordUpdateOut,
    UserOut,
)
from app.security_credentials import (
    PASSWORD_SESSION_DAYS,
    hash_password,
    normalize_login_name,
    password_login_throttle,
    validate_password,
    verify_password,
)
from app.services import build_anniversary, counterpart, pair_love_started_on
from app.storage import MediaStorageError, build_avatar_storage_key, write_media_file

router = APIRouter(prefix="/auth", tags=["auth"])


def _password_session(user_id: int, db: Session) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(days=PASSWORD_SESSION_DAYS)
    db.add(DeviceToken(token=token, user_id=user_id, expires_at=expires_at, source="password"))
    return token, expires_at


@router.post("/login/password", response_model=PasswordSessionOut)
def login_with_password(
    payload: PasswordLoginIn,
    request: Request,
    db: Session = Depends(get_db),
) -> PasswordSessionOut:
    """Exchange a normalized login name and Argon2id password for a 90-day bearer session."""
    raw_key = unicodedata.normalize("NFKC", payload.login_name).strip().casefold()
    try:
        login_name = normalize_login_name(payload.login_name)
    except ValueError:
        login_name = None
    account_key = f"account:{login_name or raw_key}"
    ip_key = f"ip:{client_ip(request)}"
    retry_after = password_login_throttle.retry_after(account_key, ip_key)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过多，请稍后再试",
            headers={"Retry-After": str(retry_after)},
        )

    user = (
        db.execute(select(User).where(User.login_name == login_name)).scalar_one_or_none()
        if login_name is not None
        else None
    )
    if not verify_password(user.password_hash if user else None, payload.password):
        password_login_throttle.fail(account_key, ip_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录名或安全密码不正确")

    password_login_throttle.succeed(account_key, ip_key)
    token, expires_at = _password_session(user.id, db)
    db.commit()
    return PasswordSessionOut(access_token=token, expires_at=expires_at)


@router.get("/me/security-password", response_model=SecurityPasswordOut)
def read_security_password(current_user: User = Depends(get_current_user)) -> SecurityPasswordOut:
    return SecurityPasswordOut(
        login_name=current_user.login_name,
        configured=bool(current_user.login_name and current_user.password_hash),
        password_updated_at=current_user.password_updated_at,
    )


@router.put("/me/security-password", response_model=SecurityPasswordUpdateOut)
def update_security_password(
    payload: SecurityPasswordUpdateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SecurityPasswordUpdateOut:
    try:
        login_name = normalize_login_name(payload.login_name)
        password = validate_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing = db.execute(
        select(User.id).where(User.login_name == login_name, User.id != current_user.id)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="这个登录名已经被使用")

    current_user.login_name = login_name
    current_user.password_hash = hash_password(password)
    current_user.password_updated_at = utc_now()
    db.execute(
        delete(DeviceToken).where(
            DeviceToken.user_id == current_user.id,
            DeviceToken.source == "password",
        )
    )
    token, expires_at = _password_session(current_user.id, db)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="这个登录名已经被使用") from exc
    db.refresh(current_user)
    return SecurityPasswordUpdateOut(
        access_token=token,
        expires_at=expires_at,
        security=SecurityPasswordOut(
            login_name=current_user.login_name,
            configured=True,
            password_updated_at=current_user.password_updated_at,
        ),
    )


def _clean_email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if "@" not in value or len(value) > 255:
        raise HTTPException(status_code=422, detail="邮箱格式不正确")
    return value


def _clean_coords(value: str) -> str:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 2:
        raise HTTPException(status_code=422, detail="Location coords must be lng,lat")
    try:
        lng = float(parts[0])
        lat = float(parts[1])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Location coords must be numeric lng,lat") from exc
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise HTTPException(status_code=422, detail="Location coords are out of range")
    return f"{lng:.6f},{lat:.6f}"


@router.get("/me", response_model=MeOut)
def read_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeOut:
    pair = get_pair_for_user(db, current_user.id)
    return MeOut(
        user=current_user,
        counterpart=counterpart(pair, current_user),
        pair_id=pair.id,
        love_started_on=pair_love_started_on(pair),
    )


@router.get("/anniversary", response_model=AnniversaryOut)
def read_anniversary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnniversaryOut:
    pair = get_pair_for_user(db, current_user.id)
    return build_anniversary(db, pair)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: MeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    data = payload.model_dump(exclude_unset=True)
    if "display_name" in data and data["display_name"] is not None:
        current_user.display_name = data["display_name"]
    if "avatar" in data and data["avatar"] is not None:
        current_user.avatar = data["avatar"]
    if "email" in data:
        current_user.email = _clean_email(data["email"])
    db.flush()
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.patch("/me/location", response_model=UserOut)
def update_my_location(
    payload: MeLocationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    if not payload.coords and not payload.address:
        raise HTTPException(status_code=422, detail="Location address or coords is required")
    try:
        if payload.coords:
            coords = _clean_coords(payload.coords)
            resolved = amap_mcp.regeocode_location(coords, effective_amap_key(db))
            city = str(resolved.get("city") or "").strip() or payload.city
            district = str(resolved.get("district") or "").strip()
            address = payload.address or " ".join(part for part in (city, district) if part)
            label = payload.label or district or city or coords
        else:
            address = payload.address or ""
            resolved = amap_mcp.geocode_address(address, payload.city, effective_amap_key(db))
            coords = _clean_coords(str(resolved["location"]))
            city = str(resolved.get("city") or payload.city or resolved.get("province") or "").strip() or None
            district = str(resolved.get("district") or "").strip()
            label = payload.label or district or address
    except amap_mcp.AmapMCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    current_user.location_label = label
    current_user.location_address = address or label
    current_user.location_city = city
    current_user.location_coords = coords
    current_user.location_updated_at = utc_now()
    db.flush()
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.delete("/me/location", response_model=UserOut)
def delete_my_location(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    current_user.location_label = None
    current_user.location_address = None
    current_user.location_city = None
    current_user.location_coords = None
    current_user.location_updated_at = None
    db.flush()
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/me/avatar", response_model=UserOut)
def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    settings = get_settings()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported image mime type")

    body = file.file.read(settings.max_image_bytes + 1)
    if len(body) > settings.max_image_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image file is too large")
    try:
        avatar = make_avatar_image(body)
    except MediaProcessingError as exc:
        raise HTTPException(status_code=422, detail=f"Avatar image could not be generated: {exc}") from exc

    storage_key = build_avatar_storage_key(current_user.id)
    try:
        write_media_file(storage_key, avatar)
    except (MediaStorageError, OSError) as exc:
        raise HTTPException(status_code=500, detail=f"Avatar image could not be saved: {exc}") from exc

    current_user.avatar_storage_key = storage_key
    current_user.avatar_mime_type = "image/jpeg"
    current_user.avatar_size_bytes = len(avatar)
    current_user.avatar_updated_at = utc_now()
    db.flush()
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.delete("/me/avatar", response_model=UserOut)
def delete_my_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    current_user.avatar_storage_key = None
    current_user.avatar_mime_type = None
    current_user.avatar_size_bytes = None
    current_user.avatar_updated_at = None
    db.flush()
    db.commit()
    db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/login-record", response_model=LoginLogOut, status_code=status.HTTP_201_CREATED)
def create_login_record(
    payload: LoginRecordCreate,
    request: Request,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoginLogOut:
    ip = client_ip(request)
    ua = payload.user_agent or request.headers.get("user-agent")
    locale = payload.locale or request.headers.get("accept-language")
    entry = record_login(
        db,
        user_id=current_user.id,
        ip=ip,
        user_agent=ua,
        locale=locale,
        timezone_name=payload.timezone_name,
        screen=payload.screen,
    )
    background.add_task(enrich_location, entry.id, ip)
    return LoginLogOut(
        id=entry.id,
        user_id=entry.user_id,
        user=UserOut.model_validate(current_user),
        ip=entry.ip,
        user_agent=entry.user_agent,
        device=entry.device,
        os=entry.os,
        browser=entry.browser,
        locale=entry.locale,
        timezone_name=entry.timezone_name,
        screen=entry.screen,
        country=entry.country,
        region=entry.region,
        city=entry.city,
        isp=entry.isp,
        created_at=entry.created_at,
    )
