"""Admin routes for pair setup, tokens, contacts, login logs, and AI config with saved models and AMap-grounded tests."""

import secrets
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_config import get_ai_setting, list_models, preview_secret, saved_models_for_protocol, test_category_completion, update_ai_setting, update_saved_models
from app.api.dependencies import require_admin_key
from app.core.config import get_settings
from app.core.database import get_db
from app.models import AIProtocol, DeviceToken, LoginLog, Pair, User, utc_now
from app.schemas import (
    AdminAIConfigOut,
    AdminAIConfigUpdate,
    AdminAIConnectionTestOut,
    AdminAIModelListOut,
    LoginLogOut,
    PairCreate,
    PairCreated,
    PairOut,
    PairUpdate,
    UserOut,
)
from app.services import local_today, pair_love_started_on

router = APIRouter(prefix="/admin", tags=["admin"])


def _clean_email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if "@" not in value or len(value) > 255:
        raise HTTPException(status_code=422, detail="邮箱格式不正确")
    return value


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
        love_started_on=pair_love_started_on(pair),
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
    user_a = User(
        display_name=payload.user_a_display_name,
        avatar=payload.user_a_avatar or "",
        email=_clean_email(payload.user_a_email),
    )
    user_b = User(
        display_name=payload.user_b_display_name,
        avatar=payload.user_b_avatar or "",
        email=_clean_email(payload.user_b_email),
    )
    db.add_all([user_a, user_b])
    db.flush()

    love_started_on = payload.love_started_on or local_today()
    pair = Pair(user_a_id=user_a.id, user_b_id=user_b.id, love_started_on=love_started_on)
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
        love_started_on=love_started_on,
        user_a_token=user_a_token,
        user_b_token=user_b_token,
        user_a_token_expires_at=token_expires_at,
        user_b_token_expires_at=token_expires_at,
    )


@router.patch("/pairs/{pair_id}", response_model=PairOut, dependencies=[Depends(require_admin_key)])
def update_pair(pair_id: int, payload: PairUpdate, db: Session = Depends(get_db)) -> PairOut:
    pair = db.get(Pair, pair_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="Pair not found")
    data = payload.model_dump(exclude_unset=True)
    if "user_a_email" in data:
        pair.user_a.email = _clean_email(data["user_a_email"])
    if "user_b_email" in data:
        pair.user_b.email = _clean_email(data["user_b_email"])
    if "love_started_on" in data:
        pair.love_started_on = data["love_started_on"] or pair.love_started_on
    db.flush()
    db.refresh(pair)
    return pair_out(db, pair)


@router.get(
    "/login-logs",
    response_model=list[LoginLogOut],
    dependencies=[Depends(require_admin_key)],
)
def list_login_logs(
    db: Session = Depends(get_db),
    limit: int = 200,
    user_id: int | None = None,
) -> list[LoginLogOut]:
    limit = max(1, min(limit, 500))
    stmt = select(LoginLog).order_by(LoginLog.created_at.desc()).limit(limit)
    if user_id is not None:
        stmt = stmt.where(LoginLog.user_id == user_id)
    logs = db.execute(stmt).scalars().all()
    user_ids = {log.user_id for log in logs}
    users = (
        db.execute(select(User).where(User.id.in_(user_ids))).scalars().all() if user_ids else []
    )
    user_by_id = {user.id: user for user in users}
    out: list[LoginLogOut] = []
    for log in logs:
        user = user_by_id.get(log.user_id)
        out.append(
            LoginLogOut(
                id=log.id,
                user_id=log.user_id,
                user=UserOut.model_validate(user) if user else None,
                ip=log.ip,
                user_agent=log.user_agent,
                device=log.device,
                os=log.os,
                browser=log.browser,
                locale=log.locale,
                timezone_name=log.timezone_name,
                screen=log.screen,
                country=log.country,
                region=log.region,
                city=log.city,
                isp=log.isp,
                created_at=log.created_at,
            )
        )
    return out


@router.get("/ai-config", response_model=AdminAIConfigOut, dependencies=[Depends(require_admin_key)])
def get_admin_ai_config(db: Session = Depends(get_db)) -> AdminAIConfigOut:
    settings = get_settings()
    row = get_ai_setting(db)
    api_key = row.api_key or settings.llm_api_key
    amap_api_key = row.amap_api_key or settings.amap_maps_api_key
    return AdminAIConfigOut(
        protocol=row.protocol,
        selected_model=row.selected_model or settings.llm_model,
        env_model=settings.llm_model,
        openai_base_url=row.openai_base_url or settings.llm_openai_base_url,
        anthropic_base_url=row.anthropic_base_url or settings.llm_anthropic_base_url,
        api_key=api_key,
        api_key_preview=preview_secret(api_key),
        has_api_key=bool(api_key),
        amap_api_key=amap_api_key,
        amap_key_preview=preview_secret(amap_api_key),
        has_amap_key=bool(amap_api_key),
        saved_models=saved_models_for_protocol(row, row.protocol),
        updated_at=row.updated_at,
    )


@router.patch("/ai-config", response_model=AdminAIConfigOut, dependencies=[Depends(require_admin_key)])
def patch_admin_ai_config(payload: AdminAIConfigUpdate, db: Session = Depends(get_db)) -> AdminAIConfigOut:
    update_ai_setting(
        db,
        protocol=payload.protocol,
        selected_model=payload.selected_model,
        openai_base_url=payload.openai_base_url,
        anthropic_base_url=payload.anthropic_base_url,
        api_key=payload.api_key,
        amap_api_key=payload.amap_api_key,
    )
    db.commit()
    return get_admin_ai_config(db)


@router.get("/ai-config/models", response_model=AdminAIModelListOut, dependencies=[Depends(require_admin_key)])
def get_admin_ai_models(protocol: AIProtocol | None = None, db: Session = Depends(get_db)) -> AdminAIModelListOut:
    row = get_ai_setting(db)
    target_protocol = protocol or row.protocol
    try:
        models = list_models(db, target_protocol)
    except (RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"Model list request failed: {exc}") from exc
    update_saved_models(db, target_protocol, models)
    db.commit()
    return AdminAIModelListOut(models=models)


@router.post("/ai-config/test", response_model=AdminAIConnectionTestOut, dependencies=[Depends(require_admin_key)])
def test_admin_ai_config(db: Session = Depends(get_db)) -> AdminAIConnectionTestOut:
    try:
        result = test_category_completion(db)
    except (RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"AI connection test failed: {exc}") from exc
    category = result["category"]
    return AdminAIConnectionTestOut(
        ok=True,
        message=f"AMap evidence ok, completion ok, sample category: {category}",
        sample_category=category,
        sample_keyword=result["sample_keyword"],
        amap_name=result["amap_name"],
        amap_address=result["amap_address"],
        amap_poi_type=result["amap_poi_type"],
        amap_poi_id=result["amap_poi_id"],
        amap_category=result["amap_category"],
        amap_category_reason=result["amap_category_reason"],
        llm_category=result["llm_category"],
        llm_status=result["llm_status"],
        llm_message=result["llm_message"],
        evidence_note=result["evidence_note"],
    )
