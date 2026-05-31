"""Authenticated user routes for profile, avatar upload, pair context, login logs, and home reminders."""

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_pair_for_user
from app.core.config import get_settings
from app.core.database import get_db
from app.login_logs import client_ip, enrich_location, record_login
from app.media import MediaProcessingError, make_avatar_image
from app.models import User, utc_now
from app.schemas import AnniversaryOut, LoginLogOut, LoginRecordCreate, MeOut, MeUpdate, UserOut
from app.services import build_anniversary, counterpart, pair_love_started_on
from app.storage import MediaStorageError, build_avatar_storage_key, write_media_file

router = APIRouter(prefix="/auth", tags=["auth"])


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
