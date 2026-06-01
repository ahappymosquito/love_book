"""Admin AI configuration helpers for editable endpoints, keys, model listing, and connection tests."""

from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AIProtocol, AISetting, User


def preview_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return f"{value[:2]}***"
    return f"{value[:4]}***{value[-4:]}"


def normalize_protocol(value: str | AIProtocol) -> AIProtocol:
    if isinstance(value, AIProtocol):
        return value
    return AIProtocol(value if value in {item.value for item in AIProtocol} else AIProtocol.openai.value)


def get_ai_setting(db: Session) -> AISetting:
    settings = get_settings()
    row = db.get(AISetting, 1)
    if row is None:
        row = AISetting(
            id=1,
            protocol=normalize_protocol(settings.llm_protocol),
            selected_model=settings.llm_model,
            openai_base_url=settings.llm_openai_base_url,
            anthropic_base_url=settings.llm_anthropic_base_url,
            api_key=settings.llm_api_key,
            amap_api_key=settings.amap_maps_api_key,
        )
        db.add(row)
        db.flush()
    return row


def update_ai_setting(
    db: Session,
    *,
    protocol: AIProtocol,
    selected_model: str,
    openai_base_url: str,
    anthropic_base_url: str,
    api_key: str,
    amap_api_key: str,
    user: User | None = None,
) -> AISetting:
    row = get_ai_setting(db)
    row.protocol = protocol
    row.selected_model = selected_model.strip()
    row.openai_base_url = openai_base_url.strip().rstrip("/")
    row.anthropic_base_url = anthropic_base_url.strip().rstrip("/")
    row.api_key = api_key.strip()
    row.amap_api_key = amap_api_key.strip()
    row.updated_by_id = user.id if user else None
    db.add(row)
    db.flush()
    return row


def effective_model(db: Session) -> str:
    row = get_ai_setting(db)
    return row.selected_model or get_settings().llm_model


def effective_api_key(db: Session) -> str:
    row = get_ai_setting(db)
    return row.api_key or get_settings().llm_api_key


def effective_amap_key(db: Session | None = None) -> str:
    settings = get_settings()
    if db is None:
        return settings.amap_maps_api_key
    row = get_ai_setting(db)
    return row.amap_api_key or settings.amap_maps_api_key


def protocol_base_url(db: Session, protocol: AIProtocol) -> str:
    settings = get_settings()
    row = get_ai_setting(db)
    if protocol == AIProtocol.anthropic:
        return (row.anthropic_base_url or settings.llm_anthropic_base_url).rstrip("/")
    return (row.openai_base_url or settings.llm_openai_base_url).rstrip("/")


def list_models(db: Session, protocol: AIProtocol) -> list[str]:
    api_key = effective_api_key(db)
    if not api_key:
        raise RuntimeError("LLM API key is not configured")
    base_url = protocol_base_url(db, protocol)
    if protocol == AIProtocol.anthropic:
        url = f"{base_url}/v1/models"
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    else:
        url = f"{base_url}/models"
        headers = {"Authorization": f"Bearer {api_key}"}
    response = httpx.get(url, headers=headers, timeout=15)
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        return []
    ids: list[str] = []
    for item in data:
        if isinstance(item, dict):
            model_id = item.get("id") or item.get("name")
            if model_id:
                ids.append(str(model_id))
        elif isinstance(item, str):
            ids.append(item)
    return ids
