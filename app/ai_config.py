"""Admin AI configuration helpers for editable endpoints, saved model lists, AMap-grounded category tests, and LLM diagnostics."""

from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from app import amap_mcp
from app.core.config import get_settings
from app.models import AIProtocol, AISetting, User

CATEGORY_SYSTEM_PROMPT = (
    "Classify this couple todo item into exactly one category. "
    "Return only one token: food or play. "
    "food means eating, drinking, restaurants, cafes, snacks, meals, stores related to food. "
    "play means entertainment, activity, travel, shopping, games, movies, sports, chores, or anything else."
)

CATEGORY_MAX_TOKENS = 64
CATEGORY_RETRY_MAX_TOKENS = 256
ADMIN_TEST_RESTAURANT_KEYWORD = "江西小炒(西溪北苑东区店)"
AMAP_FOOD_TYPE_PREFIX = "05"
AMAP_FOOD_TYPE_WORDS = ("餐饮", "美食", "小吃", "中餐", "饭店", "餐厅", "火锅", "炒菜", "菜馆")


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


def saved_models_for_protocol(row: AISetting, protocol: AIProtocol) -> list[str]:
    models = row.anthropic_models if protocol == AIProtocol.anthropic else row.openai_models
    return [str(model) for model in models or [] if str(model)]


def update_saved_models(db: Session, protocol: AIProtocol, models: list[str]) -> AISetting:
    row = get_ai_setting(db)
    cleaned = [model.strip() for model in models if model.strip()]
    if protocol == AIProtocol.anthropic:
        row.anthropic_models = cleaned
    else:
        row.openai_models = cleaned
    if not row.selected_model and cleaned:
        row.selected_model = cleaned[0]
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


def _category_prompt(title: str, note: str | None = None) -> str:
    return f"{CATEGORY_SYSTEM_PROMPT}\nTitle: {title}\nNote: {note or ''}"


def _extract_openai_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices", [])
    if not choices or not isinstance(choices, list):
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [part.get("text", "") for part in content if isinstance(part, dict)]
            return "".join(str(part) for part in parts)
    text = first.get("text")
    return str(text or "")


def _extract_anthropic_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    content = payload.get("content", [])
    if not content or not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            parts.append(str(item.get("text") or ""))
        elif isinstance(item, str):
            parts.append(item)
    return "".join(parts)


def normalize_category_response(text: str, response_hint: str = "") -> str:
    normalized = text.strip().lower()
    if "food" in normalized:
        return "food"
    if "play" in normalized:
        return "play"
    if not normalized:
        hint = f"; {response_hint}" if response_hint else ""
        raise RuntimeError(f"LLM returned empty category text{hint}")
    raise RuntimeError(f"LLM returned unsupported category: {text!r}")


def _openai_response_hint(payload: object) -> str:
    if not isinstance(payload, dict):
        return "OpenAI-compatible response was not a JSON object"
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return "OpenAI-compatible response did not include choices"
    first = choices[0]
    if not isinstance(first, dict):
        return "OpenAI-compatible first choice was not an object"
    finish_reason = first.get("finish_reason")
    message = first.get("message")
    keys = sorted(message.keys()) if isinstance(message, dict) else []
    return f"finish_reason={finish_reason!r}, message_keys={keys}"


def _anthropic_response_hint(payload: object) -> str:
    if not isinstance(payload, dict):
        return "Anthropic response was not a JSON object"
    stop_reason = payload.get("stop_reason")
    content = payload.get("content")
    content_types = [item.get("type") for item in content if isinstance(item, dict)] if isinstance(content, list) else []
    return f"stop_reason={stop_reason!r}, content_types={content_types}"


def complete_todo_category(db: Session, title: str, note: str | None = None) -> str:
    api_key = effective_api_key(db)
    model = effective_model(db)
    if not api_key or not model:
        raise RuntimeError("LLM API key or model is not configured")
    setting = get_ai_setting(db)
    base_url = protocol_base_url(db, setting.protocol)
    prompt = _category_prompt(title, note)
    if setting.protocol == AIProtocol.anthropic:
        text = ""
        hint = ""
        for max_tokens in (CATEGORY_MAX_TOKENS, CATEGORY_RETRY_MAX_TOKENS):
            response = httpx.post(
                f"{base_url}/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            text = _extract_anthropic_text(payload)
            hint = _anthropic_response_hint(payload)
            if text.strip() or "max_tokens" not in hint:
                break
    else:
        text = ""
        hint = ""
        for max_tokens in (CATEGORY_MAX_TOKENS, CATEGORY_RETRY_MAX_TOKENS):
            response = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_tokens": max_tokens,
                },
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            text = _extract_openai_text(payload)
            hint = _openai_response_hint(payload)
            if text.strip() or "finish_reason='length'" not in hint:
                break
    return normalize_category_response(text, hint)


def _restaurant_evidence_note(candidate: dict) -> str:
    name = candidate.get("name") or ADMIN_TEST_RESTAURANT_KEYWORD
    address = candidate.get("address") or ""
    poi_type = candidate.get("poi_type") or ""
    city = candidate.get("city") or ""
    return (
        "AMap MCP returned a real POI for this todo candidate. "
        f"name={name}; address={address}; city={city}; poi_type={poi_type}. "
        "Use the AMap evidence instead of guessing from the title."
    )


def classify_amap_poi(candidate: dict) -> tuple[str | None, str]:
    poi_type = str(candidate.get("poi_type") or "")
    name = str(candidate.get("name") or "")
    combined = f"{poi_type} {name}"
    if poi_type.startswith(AMAP_FOOD_TYPE_PREFIX) or any(word in combined for word in AMAP_FOOD_TYPE_WORDS):
        return "food", f"AMap POI type/name indicates food service: {poi_type or name}"
    return None, f"AMap POI type is not recognized as food service: {poi_type or 'empty'}"


def _llm_diagnostic(db: Session, title: str, note: str) -> tuple[str | None, str, str]:
    try:
        category = complete_todo_category(db, title, note)
    except (RuntimeError, httpx.HTTPError) as exc:
        return None, "failed", str(exc)
    return category, "ok", f"LLM returned {category}"


def test_category_completion(db: Session) -> dict[str, str | None]:
    candidates = amap_mcp.search_restaurants(
        ADMIN_TEST_RESTAURANT_KEYWORD,
        amap_key=effective_amap_key(db),
    )
    if not candidates:
        raise RuntimeError(f"AMap MCP returned no restaurant candidate for {ADMIN_TEST_RESTAURANT_KEYWORD!r}")
    candidate = candidates[0]
    title = str(candidate.get("name") or ADMIN_TEST_RESTAURANT_KEYWORD)
    note = _restaurant_evidence_note(candidate)
    amap_category, amap_reason = classify_amap_poi(candidate)
    if amap_category != "food":
        raise RuntimeError(amap_reason)
    llm_category, llm_status, llm_message = _llm_diagnostic(db, title, note)
    return {
        "category": amap_category,
        "sample_keyword": ADMIN_TEST_RESTAURANT_KEYWORD,
        "amap_name": str(candidate.get("name") or ""),
        "amap_address": str(candidate.get("address") or ""),
        "amap_poi_type": str(candidate.get("poi_type") or ""),
        "amap_poi_id": str(candidate.get("amap_poi_id") or ""),
        "amap_category": amap_category,
        "amap_category_reason": amap_reason,
        "llm_category": llm_category,
        "llm_status": llm_status,
        "llm_message": llm_message,
        "evidence_note": note,
    }
