"""Admin AI configuration helpers for env-backed keys, model listing, connection tests, and selected model storage."""

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
        )
        db.add(row)
        db.flush()
    return row


def update_ai_setting(db: Session, protocol: AIProtocol, selected_model: str, user: User | None = None) -> AISetting:
    row = get_ai_setting(db)
    row.protocol = protocol
    row.selected_model = selected_model.strip()
    row.updated_by_id = user.id if user else None
    db.add(row)
    db.flush()
    return row


def effective_model(db: Session) -> str:
    row = get_ai_setting(db)
    return row.selected_model or get_settings().llm_model


def protocol_base_url(protocol: AIProtocol) -> str:
    settings = get_settings()
    if protocol == AIProtocol.anthropic:
        return settings.llm_anthropic_base_url.rstrip("/")
    return settings.llm_openai_base_url.rstrip("/")


def list_models(protocol: AIProtocol) -> list[str]:
    settings = get_settings()
    if not settings.llm_api_key:
        raise RuntimeError("LLM_API_KEY is not configured")
    base_url = protocol_base_url(protocol)
    if protocol == AIProtocol.anthropic:
        url = f"{base_url}/v1/models"
        headers = {"x-api-key": settings.llm_api_key, "anthropic-version": "2023-06-01"}
    else:
        url = f"{base_url}/models"
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
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
