"""Development-only fallback for private media whose files live on another deployment.

Local development often points DATABASE_URL at the shared server database while image files stay in the server's
MEDIA_ROOT volume. When a stored file is missing locally and MEDIA_REMOTE_API_BASE is set (for example
https://tingle272.xyz/api), the same request path is fetched from that API with the caller's own credentials.
Production never uses the fallback.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import Request
from fastapi.responses import Response

from app.core.config import get_settings
from app.storage import PRIVATE_MEDIA_CACHE_HEADERS

logger = logging.getLogger(__name__)

FORWARDED_HEADERS = ("authorization", "x-admin-key")
REMOTE_TIMEOUT_SECONDS = 15.0


def remote_media_enabled() -> bool:
    settings = get_settings()
    return bool(settings.media_remote_api_base) and not settings.is_production


def remote_media_response(request: Request) -> Response | None:
    if not remote_media_enabled():
        return None
    base = get_settings().media_remote_api_base.rstrip("/")
    headers = {name: value for name in FORWARDED_HEADERS if (value := request.headers.get(name))}
    url = f"{base}{request.url.path}"
    try:
        upstream = httpx.get(url, headers=headers, timeout=REMOTE_TIMEOUT_SECONDS)
    except httpx.HTTPError:
        logger.warning("Remote media fallback failed for %s", request.url.path, exc_info=True)
        return None
    if upstream.status_code != 200:
        logger.info("Remote media fallback got %s for %s", upstream.status_code, request.url.path)
        return None
    return Response(
        content=upstream.content,
        media_type=upstream.headers.get("content-type") or "application/octet-stream",
        headers=dict(PRIVATE_MEDIA_CACHE_HEADERS),
    )
