"""API regression tests for admin pair setup, auth, reminders, event visibility, and database media uploads."""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.routes.admin as admin_routes
import app.cycles as cycles
import app.services as services
from app.models import DeviceToken, Voice
from tests.conftest import auth


class RaisingHTTPClient:
    @staticmethod
    def get(*args, **kwargs):
        raise RuntimeError("network disabled in test")


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self.payload


class QuoteHTTPClient:
    @staticmethod
    def get(url: str, *args, **kwargs):
        if "holiday" in url:
            return FakeResponse({"holiday": {"holiday": False, "name": ""}})
        return FakeResponse({"hitokoto": "缓存里的喜欢先到。"})


def test_admin_pair_creation_requires_admin_key(client: TestClient) -> None:
    payload = {"user_a_display_name": "A", "user_b_display_name": "B"}
    assert client.post("/admin/pairs", json=payload).status_code == 403
    assert client.post("/admin/pairs", headers={"X-Admin-Key": "wrong"}, json=payload).status_code == 403

    response = client.post("/admin/pairs", headers={"X-Admin-Key": "test-admin-key"}, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["pair_id"]
    assert data["user_a_token"]
    assert data["user_b_token"]
    assert data["love_started_on"]
    assert data["user_a_token_expires_at"] is None
    assert data["user_b_token_expires_at"] is None


def test_admin_pair_creation_accepts_love_started_on(client: TestClient) -> None:
    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2025-05-20",
        },
    )

    assert response.status_code == 200
    assert response.json()["love_started_on"] == "2025-05-20"


def test_admin_pair_creation_defaults_love_started_on_to_today(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_routes, "local_today", lambda: date(2026, 5, 22))

    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B"},
    )

    assert response.status_code == 200
    assert response.json()["love_started_on"] == "2026-05-22"


def test_admin_pairs_can_be_listed_from_database(client: TestClient) -> None:
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B"},
    ).json()

    response = client.get("/admin/pairs", headers={"X-Admin-Key": "test-admin-key"})

    assert response.status_code == 200
    pairs = response.json()
    assert pairs[0]["pair_id"] == created["pair_id"]
    assert pairs[0]["user_a"]["display_name"] == "A"
    assert pairs[0]["user_b"]["display_name"] == "B"
    assert pairs[0]["love_started_on"] == created["love_started_on"]
    assert pairs[0]["user_a_token"] == created["user_a_token"]
    assert pairs[0]["user_b_token"] == created["user_b_token"]


def test_admin_pair_can_update_love_started_on(client: TestClient) -> None:
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B"},
    ).json()

    response = client.patch(
        f"/admin/pairs/{created['pair_id']}",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"love_started_on": "2024-02-14"},
    )

    assert response.status_code == 200
    assert response.json()["love_started_on"] == "2024-02-14"


def test_admin_pair_creation_accepts_token_expiration(client: TestClient) -> None:
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B", "token_expires_at": expires_at},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user_a_token_expires_at"].endswith("Z")
    assert data["user_b_token_expires_at"] == data["user_a_token_expires_at"]
    assert client.get("/auth/me", headers=auth(data["user_a_token"])).status_code == 200


def test_admin_pair_creation_rejects_past_token_expiration(client: TestClient) -> None:
    expires_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()

    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B", "token_expires_at": expires_at},
    )

    assert response.status_code == 422


def test_expired_token_is_rejected(client: TestClient, pair_tokens: dict[str, str | int], db_session: Session) -> None:
    token = db_session.get(DeviceToken, str(pair_tokens["user_a_token"]))
    assert token is not None
    token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = client.get("/auth/me", headers=auth(str(pair_tokens["user_a_token"])))

    assert response.status_code == 401
    assert response.json()["detail"] == "Bearer token has expired"


def test_auth_me_returns_user_counterpart_and_pair(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    response = client.get("/auth/me", headers=auth(str(pair_tokens["user_a_token"])))
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["display_name"] == "A"
    assert data["counterpart"]["display_name"] == "B"
    assert data["pair_id"] == pair_tokens["pair_id"]
    assert data["love_started_on"]


def test_anniversary_endpoint_returns_520_love_festival_and_holiday_fallback(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    today = date(2026, 5, 20)
    started_on = today - timedelta(days=519)
    monkeypatch.setattr(services, "local_today", lambda: today)
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": started_on.isoformat(),
        },
    ).json()

    response = client.get("/auth/anniversary", headers=auth(created["user_a_token"]))

    assert response.status_code == 200
    data = response.json()
    assert data["days_together"] == 520
    assert data["message_source"] == "anniversary"
    assert [item["label"] for item in data["anniversary_items"]] == ["520 天"]
    assert [item["label"] for item in data["love_festival_items"]] == ["520 网络情人节"]


def test_anniversary_endpoint_returns_1314_days(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    today = date(2026, 1, 1)
    started_on = today - timedelta(days=1313)
    monkeypatch.setattr(services, "local_today", lambda: today)
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": started_on.isoformat(),
        },
    ).json()

    data = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()

    assert data["days_together"] == 1314
    assert [item["label"] for item in data["anniversary_items"]] == ["1314 天"]


def test_anniversary_endpoint_returns_monthly_anniversary(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "local_today", lambda: date(2026, 5, 22))
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2026-04-22",
        },
    ).json()

    data = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()

    assert data["anniversary_items"][0]["label"] == "1 个月"


def test_anniversary_endpoint_returns_love_festival(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "local_today", lambda: date(2026, 2, 14))
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2026-01-01",
        },
    ).json()

    data = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()

    assert data["message_source"] == "love_festival"
    assert data["love_festival_items"][0]["label"] == "情人节"


def test_anniversary_endpoint_uses_local_quote_when_hitokoto_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    services.QUOTE_CACHE.clear()
    monkeypatch.setattr(services, "local_today", lambda: date(2026, 3, 2))
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2026-01-01",
        },
    ).json()

    data = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()

    assert data["message_source"] == "local"
    assert data["message"]


def test_anniversary_endpoint_uses_cached_quote_before_refreshing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    services.QUOTE_CACHE.clear()
    monkeypatch.setattr(services, "local_today", lambda: date(2026, 3, 2))
    monkeypatch.setattr(services, "httpx", QuoteHTTPClient)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2026-01-01",
        },
    ).json()

    first = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()
    second = client.get("/auth/anniversary", headers=auth(created["user_a_token"])).json()

    assert first["message_source"] == "local"
    assert second["message_source"] == "hitokoto"
    assert second["message"] == "缓存里的喜欢先到。"


def test_public_event_contents_are_immediately_visible(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Dinner", "visibility_mode": "public"},
    ).json()

    comment = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(token_a),
        json={"text": "hello"},
    )
    assert comment.status_code == 201

    contents = client.get(f"/events/{event['id']}/contents", headers=auth(token_b))
    assert contents.status_code == 200
    data = contents.json()
    assert data["submission_state"]["unlocked"] is True
    assert [item["text"] for item in data["comments"]] == ["hello"]


def test_event_datetimes_are_returned_as_utc_instants(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    response = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={
            "title": "Timezone",
            "occurred_at": "2026-04-29T10:00:00Z",
            "visibility_mode": "public",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["occurred_at"] == "2026-04-29T10:00:00Z"
    assert data["created_at"].endswith("Z")


def test_mutual_submit_unlocks_after_each_side_submits_any_content(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Secret", "visibility_mode": "mutual_submit"},
    ).json()

    client.post(f"/events/{event['id']}/comments", headers=auth(token_a), json={"text": "a-comment"})
    before = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()
    assert before["submission_state"] == {
        "current_user_submitted": False,
        "counterpart_submitted": True,
        "unlocked": False,
    }
    assert before["comments"] == []
    assert before["voices"] == []

    upload = client.post(
        f"/events/{event['id']}/voices",
        headers=auth(token_b),
        files={"file": ("note.webm", b"voice-bytes", "audio/webm;codecs=opus")},
        data={"duration_ms": "1000"},
    )
    assert upload.status_code == 201
    voice_id = upload.json()["id"]
    stored_voice = db_session.get(Voice, voice_id)
    assert stored_voice is not None
    assert stored_voice.file_path == ""
    assert stored_voice.data == b"voice-bytes"
    assert stored_voice.mime_type == "audio/webm"

    after_a = client.get(f"/events/{event['id']}/contents", headers=auth(token_a)).json()
    after_b = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()
    assert after_a["submission_state"]["unlocked"] is True
    assert after_b["submission_state"]["unlocked"] is True
    assert [item["text"] for item in after_a["comments"]] == ["a-comment"]
    assert after_a["voices"][0]["id"] == voice_id
    downloaded = client.get(f"/voices/{voice_id}/file", headers=auth(token_a))
    assert downloaded.status_code == 200
    assert downloaded.content == b"voice-bytes"
    assert downloaded.headers["content-type"].startswith("audio/webm")


def test_locked_event_email_hides_event_content(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, str]] = []

    def fake_send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        sent.append({"to": to, "subject": subject, "text": text_body, "html": html_body or ""})
        return True

    monkeypatch.setattr("app.emailer.send_email", fake_send_email)
    pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "user_a_email": "a@example.com",
            "user_b_email": "b@example.com",
        },
    ).json()

    response = client.post(
        "/events",
        headers=auth(pair["user_a_token"]),
        json={"title": "秘密标题", "description": "秘密摘要", "visibility_mode": "mutual_submit"},
    )

    assert response.status_code == 201
    assert sent
    message = sent[-1]
    combined = f"{message['subject']}\n{message['text']}\n{message['html']}"
    assert "待解锁" in combined
    assert "秘密标题" not in combined
    assert "秘密摘要" not in combined


def test_comment_email_respects_unlock_state(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, str]] = []

    def fake_send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        sent.append({"to": to, "subject": subject, "text": text_body, "html": html_body or ""})
        return True

    monkeypatch.setattr("app.emailer.send_email", fake_send_email)
    pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "user_a_email": "a@example.com",
            "user_b_email": "b@example.com",
        },
    ).json()
    event = client.post(
        "/events",
        headers=auth(pair["user_a_token"]),
        json={"title": "秘密事件", "visibility_mode": "mutual_submit"},
    ).json()
    sent.clear()

    first = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(pair["user_a_token"]),
        json={"text": "第一条秘密评论"},
    )
    assert first.status_code == 201
    locked_message = sent[-1]
    locked_combined = f"{locked_message['subject']}\n{locked_message['text']}\n{locked_message['html']}"
    assert "待解锁" in locked_combined
    assert "秘密事件" not in locked_combined
    assert "第一条秘密评论" not in locked_combined

    second = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(pair["user_b_token"]),
        json={"text": "第二条解锁评论"},
    )
    assert second.status_code == 201
    unlocked_message = sent[-1]
    unlocked_combined = f"{unlocked_message['subject']}\n{unlocked_message['text']}\n{unlocked_message['html']}"
    assert "秘密事件" in unlocked_combined
    assert "第二条解锁评论" in unlocked_combined


def test_mutual_submit_blocks_voice_download_until_unlocked(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Voice", "visibility_mode": "mutual_submit"},
    ).json()
    upload = client.post(
        f"/events/{event['id']}/voices",
        headers=auth(token_a),
        files={"file": ("note.webm", b"voice-bytes", "audio/webm")},
    )
    assert upload.status_code == 201
    voice_id = upload.json()["id"]

    blocked = client.get(f"/voices/{voice_id}/file", headers=auth(token_b))
    assert blocked.status_code == 403


def test_legacy_voice_without_database_data_is_not_downloaded(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    event = client.post(
        "/events",
        headers=auth(token),
        json={"title": "Legacy voice", "visibility_mode": "public"},
    ).json()
    legacy_voice = Voice(
        event_id=event["id"],
        author_id=int(pair_tokens["user_a"]["id"]),
        file_path="uploads/legacy.webm",
        data=None,
        duration_ms=1000,
        mime_type="audio/webm",
        size_bytes=11,
    )
    db_session.add(legacy_voice)
    db_session.commit()
    db_session.refresh(legacy_voice)

    response = client.get(f"/voices/{legacy_voice.id}/file", headers=auth(token))

    assert response.status_code == 404


def test_third_pair_cannot_access_events(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    event = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"title": "Private", "visibility_mode": "public"},
    ).json()

    response = client.get(f"/events/{event['id']}", headers=auth(str(other_pair["user_a_token"])))
    assert response.status_code == 404


def test_only_creator_can_update_or_delete_event(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Owned", "visibility_mode": "public"},
    ).json()

    assert client.patch(f"/events/{event['id']}", headers=auth(token_b), json={"title": "No"}).status_code == 403
    assert client.delete(f"/events/{event['id']}", headers=auth(token_b)).status_code == 403
    assert client.patch(f"/events/{event['id']}", headers=auth(token_a), json={"title": "Yes"}).status_code == 200
    assert client.delete(f"/events/{event['id']}", headers=auth(token_a)).status_code == 204


def test_voice_upload_rejects_non_audio(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    event = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"title": "Upload", "visibility_mode": "public"},
    ).json()
    response = client.post(
        f"/events/{event['id']}/voices",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("bad.txt", b"text", "text/plain")},
    )
    assert response.status_code == 415


def test_cycle_dashboard_requires_login(client: TestClient) -> None:
    response = client.get("/cycles/dashboard?start=2026-05-01&end=2026-05-31")

    assert response.status_code == 401


def test_cycle_log_upsert_is_shared_inside_pair_and_immediately_readable(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])

    created = client.put(
        "/cycles/logs/2026-05-20",
        headers=auth(token_a),
        json={
            "phase": "menstrual",
            "is_period": True,
            "flow": "medium",
            "symptoms": ["腹痛", "疲劳"],
            "mood": "calm",
            "bbt": 36.6,
            "cervical_mucus": "none",
            "note": "写后立即可读",
        },
    )

    assert created.status_code == 200
    assert created.json()["updated_by_id"] == pair_tokens["user_a"]["id"]
    dashboard = client.get("/cycles/dashboard?start=2026-05-01&end=2026-05-31", headers=auth(token_b))
    assert dashboard.status_code == 200
    logs = dashboard.json()["logs"]
    shared = next(item for item in logs if item["date"] == "2026-05-20")
    assert shared["source"] == "recorded"
    assert shared["note"] == "写后立即可读"
    assert shared["symptoms"] == ["腹痛", "疲劳"]


def test_cycle_logs_are_isolated_between_pairs(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    client.put(
        "/cycles/logs/2026-05-20",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"phase": "menstrual", "is_period": True, "flow": "light"},
    )

    response = client.get("/cycles/dashboard?start=2026-05-20&end=2026-05-20", headers=auth(other_pair["user_a_token"]))

    assert response.status_code == 200
    assert response.json()["is_empty"] is True
    assert response.json()["logs"][0]["source"] == "predicted"


def test_cycle_example_data_stats_and_clear(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])

    seeded = client.post("/cycles/example-data", headers=auth(token))
    assert seeded.status_code == 201
    assert len(seeded.json()) > 10

    dashboard = client.get("/cycles/dashboard?start=2026-05-01&end=2026-05-31", headers=auth(token)).json()
    assert dashboard["is_empty"] is False
    assert dashboard["stats"]["average_cycle_length"] == 28
    assert dashboard["stats"]["confidence"] == "medium"
    assert dashboard["stats"]["next_period_start"] == "2026-05-22"

    removed = client.delete("/cycles/logs", headers=auth(token))
    assert removed.status_code == 204
    empty = client.get("/cycles/dashboard?start=2026-05-01&end=2026-05-31", headers=auth(token)).json()
    assert empty["is_empty"] is True


def test_cycle_log_delete_removes_single_day(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    client.put(
        "/cycles/logs/2026-05-20",
        headers=auth(token),
        json={"phase": "menstrual", "is_period": True, "flow": "medium"},
    )

    assert client.delete("/cycles/logs/2026-05-20", headers=auth(token)).status_code == 204
    dashboard = client.get("/cycles/dashboard?start=2026-05-20&end=2026-05-20", headers=auth(token)).json()
    assert dashboard["logs"][0]["source"] == "predicted"
