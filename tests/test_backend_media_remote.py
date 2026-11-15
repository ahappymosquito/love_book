"""Development media fallback: missing local files are fetched from MEDIA_REMOTE_API_BASE, never in production."""

from io import BytesIO
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image as PILImage

from app import media_remote
from app.core.config import get_settings
from tests.conftest import auth


def _jpeg() -> bytes:
    buffer = BytesIO()
    PILImage.new("RGB", (8, 8), (200, 80, 90)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _upload_then_lose_files(client: TestClient, token: str) -> int:
    event = client.post("/events", headers=auth(token), json={"title": "有照片"})
    assert event.status_code == 201
    image = client.post(
        f"/events/{event.json()['id']}/images",
        headers=auth(token),
        files={"file": ("a.jpg", _jpeg(), "image/jpeg")},
    )
    assert image.status_code == 201
    for path in Path(get_settings().media_root).rglob("*.jpg"):
        path.unlink()
    return image.json()["id"]


def test_missing_local_media_is_fetched_from_remote_api(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    token = str(pair_tokens["user_a_token"])
    image_id = _upload_then_lose_files(client, token)
    settings = get_settings()
    settings.media_remote_api_base = "https://example.test/api/"
    calls: list[tuple[str, dict[str, str]]] = []

    def fake_get(url: str, headers: dict[str, str], timeout: float) -> httpx.Response:
        calls.append((url, headers))
        return httpx.Response(200, content=b"remote-bytes", headers={"content-type": "image/jpeg"})

    monkeypatch.setattr(media_remote.httpx, "get", fake_get)

    thumb = client.get(f"/images/{image_id}/thumb", headers=auth(token))
    original = client.get(f"/images/{image_id}/file", headers=auth(token))

    assert thumb.status_code == 200 and thumb.content == b"remote-bytes"
    assert original.status_code == 200 and original.content == b"remote-bytes"
    assert [url for url, _ in calls] == [
        f"https://example.test/api/images/{image_id}/thumb",
        f"https://example.test/api/images/{image_id}/file",
    ]
    assert calls[0][1]["authorization"] == f"Bearer {token}"


def test_remote_media_fallback_is_ignored_in_production(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    token = str(pair_tokens["user_a_token"])
    image_id = _upload_then_lose_files(client, token)
    settings = get_settings()
    settings.media_remote_api_base = "https://example.test/api"
    settings.app_env = "production"

    def fail_get(*_args, **_kwargs) -> httpx.Response:
        raise AssertionError("production must not call the remote media API")

    monkeypatch.setattr(media_remote.httpx, "get", fail_get)

    assert client.get(f"/images/{image_id}/file", headers=auth(token)).status_code == 404
