"""API regression tests for auth, profiles, user locations, habit dashboards and reminders, media, sampled quotes, typed timeline events with automatic meetings and batch assignment, todo boards, cycle fact storage with predicted phases, AMap-grounded AI tests, and fallback data."""

from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy import select
from sqlalchemy.orm import Session

import app.api.routes.admin as admin_routes
import app.api.routes.quotes as quote_routes
import app.core.database as database
import app.cycles as cycles
import app.habits as habits
import app.services as services
from app.core.config import get_settings
from app.models import AISetting, CycleDailyLog, CyclePhase, DefaultQuote, DeviceToken, Event, HabitReminderRun, HabitTask, Image as DBImage, MeetingSession, TodoImage, Voice
from app.storage import media_path
from tests.conftest import auth


class RaisingHTTPClient:
    @staticmethod
    def get(*args, **kwargs):
        raise RuntimeError("network disabled in test")


def sample_png_bytes() -> bytes:
    output = BytesIO()
    image = PILImage.new("RGB", (40, 28), color=(220, 80, 120))
    image.save(output, format="PNG")
    return output.getvalue()


def test_todo_category_enum_migration_sql_targets_mysql_only() -> None:
    expected = [
        "ALTER TABLE todo_items MODIFY category ENUM('food','play','stay','wish') NOT NULL",
        "ALTER TABLE todo_candidates MODIFY category ENUM('food','play','stay','wish') NOT NULL",
    ]

    assert database._todo_category_enum_migration_sql("mysql") == expected
    assert database._todo_category_enum_migration_sql("mariadb") == expected
    assert database._todo_category_enum_migration_sql("sqlite") == []


def test_event_kind_lightweight_migration_column_is_registered() -> None:
    assert (
        "events",
        "event_kind",
        {"default": "VARCHAR(50) NOT NULL DEFAULT 'memory'"},
    ) in database._LIGHTWEIGHT_COLUMNS
    assert (
        "events",
        "meeting_session_id",
        {"default": "INTEGER NULL", "mysql": "INT NULL", "mariadb": "INT NULL"},
    ) in database._LIGHTWEIGHT_COLUMNS


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
    assert data["user"]["avatar_has_image"] is False


def test_user_can_update_profile_name_avatar_and_email(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])

    updated = client.patch(
        "/auth/me",
        headers=auth(token),
        json={"display_name": "New A", "avatar": "🌷", "email": "  a@example.com  "},
    )
    reloaded = client.get("/auth/me", headers=auth(token))

    assert updated.status_code == 200
    assert updated.json()["display_name"] == "New A"
    assert updated.json()["avatar"] == "🌷"
    assert updated.json()["email"] == "a@example.com"
    assert reloaded.json()["user"]["email"] == "a@example.com"


def test_user_profile_update_normalizes_blank_email(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    client.patch("/auth/me", headers=auth(token), json={"email": "a@example.com"})

    updated = client.patch("/auth/me", headers=auth(token), json={"email": "   "})

    assert updated.status_code == 200
    assert updated.json()["email"] is None


def test_user_profile_update_rejects_invalid_email(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    response = client.patch(
        "/auth/me",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"email": "not-an-email"},
    )

    assert response.status_code == 422


def test_habit_dashboard_and_toggle_are_pair_scoped(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    created = client.post("/habits/tasks", headers=auth(token_a), json={"title": "喝水", "color": "sage"})
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()

    blocked = client.post(
        f"/habits/tasks/{created.json()['id']}/toggle",
        headers=auth(token_b),
        params={"target_date": "2026-06-10", "start": "2026-06-01", "end": "2026-06-30"},
    )
    missing_for_other_pair = client.post(
        f"/habits/tasks/{created.json()['id']}/toggle",
        headers=auth(str(other_pair["user_a_token"])),
        params={"target_date": "2026-06-10", "start": "2026-06-01", "end": "2026-06-30"},
    )

    assert created.status_code == 201
    assert blocked.status_code == 404
    assert missing_for_other_pair.status_code == 404


def test_habit_toggle_commits_and_dashboard_counts(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    task = client.post("/habits/tasks", headers=auth(token), json={"title": "早睡", "color": "rose"}).json()

    toggled = client.post(
        f"/habits/tasks/{task['id']}/toggle",
        headers=auth(token),
        params={"target_date": "2026-06-10", "start": "2026-06-01", "end": "2026-06-30"},
    )
    dashboard = client.get(
        "/habits/dashboard",
        headers=auth(token),
        params={"start": "2026-06-01", "end": "2026-06-30"},
    ).json()
    untoggled = client.post(
        f"/habits/tasks/{task['id']}/toggle",
        headers=auth(token),
        params={"target_date": "2026-06-10", "start": "2026-06-01", "end": "2026-06-30"},
    )

    target_day = next(day for day in dashboard["days"] if day["date"] == "2026-06-10")
    user_day = next(item for item in target_day["users"] if item["user_id"] == pair_tokens["user_a"]["id"])
    assert toggled.status_code == 200
    assert toggled.json()["checked"] is True
    assert user_day["tasks_total"] == 1
    assert user_day["completed_count"] == 1
    assert user_day["all_completed"] is True
    assert untoggled.status_code == 200
    assert untoggled.json()["checked"] is False


def test_habit_reminder_scan_sends_only_unfinished_once(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = str(pair_tokens["user_a_token"])
    client.patch("/auth/me", headers=auth(token), json={"email": "a@example.com"})
    task = client.post("/habits/tasks", headers=auth(token), json={"title": "拉伸", "color": "peach"}).json()
    sent: list[dict[str, object]] = []
    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: sent.append(kwargs))

    first_count = habits.scan_habit_reminders(db_session, date(2026, 6, 10))
    second_count = habits.scan_habit_reminders(db_session, date(2026, 6, 10))
    client.post(
        f"/habits/tasks/{task['id']}/toggle",
        headers=auth(token),
        params={"target_date": "2026-06-11", "start": "2026-06-01", "end": "2026-06-30"},
    )
    completed_count = habits.scan_habit_reminders(db_session, date(2026, 6, 11))

    assert first_count == 1
    assert second_count == 0
    assert completed_count == 0
    assert len(sent) == 1
    assert sent[0]["recipient_email"] == "a@example.com"
    assert db_session.query(HabitReminderRun).filter_by(date=date(2026, 6, 10)).count() == 1


def test_habit_reminder_skips_no_email_and_inactive_habits(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = str(pair_tokens["user_a_token"])
    task = client.post("/habits/tasks", headers=auth(token), json={"title": "阅读", "color": "sage"}).json()
    sent: list[dict[str, object]] = []
    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: sent.append(kwargs))

    no_email_count = habits.scan_habit_reminders(db_session, date(2026, 6, 10))
    client.patch("/auth/me", headers=auth(token), json={"email": "a@example.com"})
    client.delete(f"/habits/tasks/{task['id']}", headers=auth(token))
    inactive_count = habits.scan_habit_reminders(db_session, date(2026, 6, 11))

    assert no_email_count == 0
    assert inactive_count == 0
    assert sent == []
    assert db_session.query(HabitTask).filter_by(id=task["id"]).one().is_active is False


def test_user_can_save_browser_location_and_clear_it(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.api.routes.auth.amap_mcp.regeocode_location",
        lambda location, amap_key=None: {"city": "杭州市", "district": "余杭区"},
    )

    saved = client.patch(
        "/auth/me/location",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"coords": "120.027121,30.288808"},
    )
    reloaded = client.get("/auth/me", headers=auth(str(pair_tokens["user_a_token"])))
    cleared = client.delete("/auth/me/location", headers=auth(str(pair_tokens["user_a_token"])))

    assert saved.status_code == 200
    assert saved.json()["location_coords"] == "120.027121,30.288808"
    assert saved.json()["location_city"] == "杭州市"
    assert saved.json()["location_label"] == "余杭区"
    assert saved.json()["location_updated_at"]
    assert reloaded.json()["user"]["location_coords"] == "120.027121,30.288808"
    assert cleared.status_code == 200
    assert cleared.json()["location_coords"] is None


def test_user_can_save_manual_location_and_failed_geocode_does_not_write(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.api.routes.auth.amap_mcp.geocode_address",
        lambda address, city=None, amap_key=None: {
            "location": "120.028000,30.289000",
            "city": city,
            "district": "未来科技城",
        },
    )
    saved = client.patch(
        "/auth/me/location",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"address": "西溪北苑东区", "city": "杭州"},
    )

    from app.amap_mcp import AmapMCPError

    monkeypatch.setattr(
        "app.api.routes.auth.amap_mcp.geocode_address",
        lambda address, city=None, amap_key=None: (_ for _ in ()).throw(AmapMCPError("geocode failed")),
    )
    failed = client.patch(
        "/auth/me/location",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"address": "不存在的位置"},
    )
    reloaded = client.get("/auth/me", headers=auth(str(pair_tokens["user_a_token"])))

    assert saved.status_code == 200
    assert saved.json()["location_address"] == "西溪北苑东区"
    assert saved.json()["location_city"] == "杭州"
    assert saved.json()["location_label"] == "未来科技城"
    assert failed.status_code == 502
    assert reloaded.json()["user"]["location_address"] == "西溪北苑东区"


def test_user_can_upload_and_pair_can_read_avatar(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])

    uploaded = client.post(
        "/auth/me/avatar",
        headers=auth(token_a),
        files={"file": ("avatar.png", sample_png_bytes(), "image/png")},
    )

    assert uploaded.status_code == 200
    user = uploaded.json()
    assert user["avatar_has_image"] is True
    assert user["avatar_updated_at"]

    me = client.get("/auth/me", headers=auth(token_a)).json()
    assert me["user"]["avatar_has_image"] is True
    downloaded = client.get(f"/users/{user['id']}/avatar", headers=auth(token_b))
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"].startswith("image/jpeg")
    assert downloaded.headers["cache-control"] == "private, max-age=604800"
    assert downloaded.content.startswith(b"\xff\xd8")


def test_user_avatar_download_is_pair_private(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    uploaded = client.post(
        "/auth/me/avatar",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("avatar.png", sample_png_bytes(), "image/png")},
    ).json()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()

    blocked = client.get(f"/users/{uploaded['id']}/avatar", headers=auth(other_pair["user_a_token"]))
    admin = client.get(f"/users/{uploaded['id']}/avatar", headers={"X-Admin-Key": "test-admin-key"})

    assert blocked.status_code == 404
    assert admin.status_code == 200


def test_user_avatar_upload_rejects_invalid_type_and_oversize(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token = str(pair_tokens["user_a_token"])
    bad_type = client.post(
        "/auth/me/avatar",
        headers=auth(token),
        files={"file": ("avatar.txt", b"not-image", "text/plain")},
    )

    settings = get_settings()
    previous_limit = settings.max_image_bytes
    settings.max_image_bytes = 4
    try:
        too_large = client.post(
            "/auth/me/avatar",
            headers=auth(token),
            files={"file": ("avatar.png", sample_png_bytes(), "image/png")},
        )
    finally:
        settings.max_image_bytes = previous_limit

    assert bad_type.status_code == 415
    assert too_large.status_code == 413


def test_user_can_delete_uploaded_avatar_and_fallback_to_emoji(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token = str(pair_tokens["user_a_token"])
    uploaded = client.post(
        "/auth/me/avatar",
        headers=auth(token),
        files={"file": ("avatar.png", sample_png_bytes(), "image/png")},
    ).json()

    deleted = client.delete("/auth/me/avatar", headers=auth(token))
    missing = client.get(f"/users/{uploaded['id']}/avatar", headers=auth(token))

    assert deleted.status_code == 200
    assert deleted.json()["avatar_has_image"] is False
    assert deleted.json()["avatar"] == uploaded["avatar"]
    assert missing.status_code == 404


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


def test_anniversary_endpoint_uses_default_local_quote_when_quote_library_is_empty(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
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
    assert data["message"] in services.DEFAULT_LOVE_QUOTES
    stored_defaults = db_session.query(DefaultQuote).all()
    assert {item.text for item in stored_defaults} == set(services.DEFAULT_LOVE_QUOTES)


def test_anniversary_endpoint_uses_pair_and_default_quotes_in_one_random_pool(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    choices_seen: list[list[str]] = []

    def choose_last(items: list[str]) -> str:
        choices_seen.append(list(items))
        return items[-1]

    monkeypatch.setattr(services, "local_today", lambda: date(2026, 3, 2))
    monkeypatch.setattr(services, "httpx", RaisingHTTPClient)
    monkeypatch.setattr(services.random, "choice", choose_last)
    created = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "love_started_on": "2026-01-01",
        },
    ).json()

    quote = client.post("/quotes", headers=auth(created["user_a_token"]), json={"text": "数据库里的喜欢先到。"})
    data = client.get("/auth/anniversary", headers=auth(created["user_b_token"])).json()

    assert quote.status_code == 201
    assert data["message_source"] == "local"
    assert data["message"] == services.DEFAULT_LOVE_QUOTES[-1]
    assert choices_seen
    quote_pool = choices_seen[-1]
    assert "数据库里的喜欢先到。" in quote_pool
    assert set(services.DEFAULT_LOVE_QUOTES).issubset(set(quote_pool))


def test_quotes_require_login(client: TestClient) -> None:
    assert client.get("/quotes").status_code == 401
    assert client.get("/quotes/sample").status_code == 401
    assert client.post("/quotes", json={"text": "hello"}).status_code == 401


def test_quote_sample_combines_pair_and_default_quotes_without_cross_pair_leaks(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    token = str(pair_tokens["user_a_token"])
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    assert client.post("/quotes", headers=auth(token), json={"text": "只属于第一对"}).status_code == 201
    assert client.post(
        "/quotes",
        headers=auth(other_pair["user_a_token"]),
        json={"text": "只属于第二对"},
    ).status_code == 201

    def fail_if_holiday_is_loaded(*args: object, **kwargs: object) -> object:
        raise AssertionError("quote sampling must not load holiday data")

    monkeypatch.setattr(services, "fetch_holiday_item", fail_if_holiday_is_loaded)
    response = client.get("/quotes/sample?limit=10", headers=auth(token))

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == len(set(items))
    assert len(items) <= 10
    assert "只属于第一对" in items
    assert "只属于第二对" not in items
    assert set(services.DEFAULT_LOVE_QUOTES).issubset(set(items))
    assert client.get("/quotes/sample?limit=0", headers=auth(token)).status_code == 422
    assert client.get("/quotes/sample?limit=11", headers=auth(token)).status_code == 422


def test_quote_sample_returns_available_items_when_pool_is_smaller_than_limit(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = str(pair_tokens["user_a_token"])
    db_session.query(DefaultQuote).delete()
    db_session.commit()
    monkeypatch.setattr(quote_routes, "ensure_default_quotes", lambda db: None)
    assert client.post("/quotes", headers=auth(token), json={"text": "第一句"}).status_code == 201
    assert client.post("/quotes", headers=auth(token), json={"text": "第二句"}).status_code == 201

    response = client.get("/quotes/sample?limit=5", headers=auth(token))

    assert response.status_code == 200
    assert set(response.json()["items"]) == {"第一句", "第二句"}


def test_quote_text_must_not_be_blank(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    response = client.post("/quotes", headers=auth(str(pair_tokens["user_a_token"])), json={"text": "   "})

    assert response.status_code == 422


def test_quotes_are_shared_inside_pair_and_can_be_deleted(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])

    created = client.post("/quotes", headers=auth(token_a), json={"text": "一起保存的一句话"})

    assert created.status_code == 201
    quote_id = created.json()["id"]
    listed = client.get("/quotes", headers=auth(token_b)).json()
    assert [item["text"] for item in listed] == ["一起保存的一句话"]

    removed = client.delete(f"/quotes/{quote_id}", headers=auth(token_b))
    assert removed.status_code == 204
    assert client.get("/quotes", headers=auth(token_a)).json() == []


def test_default_quotes_are_listed_without_pair_quotes(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    created = client.post("/quotes", headers=auth(token), json={"text": "只属于这一对"})

    response = client.get("/quotes/defaults", headers=auth(token))

    assert created.status_code == 201
    assert response.status_code == 200
    texts = [item["text"] for item in response.json()]
    assert set(texts) == set(services.DEFAULT_LOVE_QUOTES)
    assert "只属于这一对" not in texts


def test_quotes_are_isolated_between_pairs(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    created = client.post("/quotes", headers=auth(token_a), json={"text": "只属于第一对"})
    quote_id = created.json()["id"]

    assert client.get("/quotes", headers=auth(other_pair["user_a_token"])).json() == []
    assert client.delete(f"/quotes/{quote_id}", headers=auth(other_pair["user_a_token"])).status_code == 404
    assert client.delete("/quotes/999999", headers=auth(token_a)).status_code == 404


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
    assert data["comments"][0]["reactions"] == []


def test_comment_reactions_switch_cancel_and_do_not_count_as_submission(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Reaction", "visibility_mode": "public"},
    ).json()
    comment = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(token_a),
        json={"text": "react to me"},
    ).json()

    liked = client.put(f"/comments/{comment['id']}/reaction", headers=auth(token_b), json={"reaction_type": "like"})
    seen_by_a = client.get(f"/events/{event['id']}/contents", headers=auth(token_a)).json()
    seen_by_b = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()

    assert liked.status_code == 200
    assert liked.json()["reactions"] == [{"reaction_type": "like", "count": 1, "reacted_by_me": True}]
    assert seen_by_a["comments"][0]["reactions"] == [{"reaction_type": "like", "count": 1, "reacted_by_me": False}]
    assert seen_by_b["submission_state"]["current_user_submitted"] is False

    switched = client.put(
        f"/comments/{comment['id']}/reaction",
        headers=auth(token_b),
        json={"reaction_type": "dislike"},
    )
    cancelled = client.delete(f"/comments/{comment['id']}/reaction", headers=auth(token_b))

    assert switched.status_code == 200
    assert switched.json()["reactions"] == [{"reaction_type": "dislike", "count": 1, "reacted_by_me": True}]
    assert cancelled.status_code == 200
    assert cancelled.json()["reactions"] == []


def test_comment_reactions_are_pair_private(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token_a = str(pair_tokens["user_a_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Private reaction", "visibility_mode": "public"},
    ).json()
    comment = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(token_a),
        json={"text": "same pair only"},
    ).json()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()

    response = client.put(
        f"/comments/{comment['id']}/reaction",
        headers=auth(other_pair["user_a_token"]),
        json={"reaction_type": "like"},
    )

    assert response.status_code == 404


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


def test_event_kind_defaults_create_list_detail_and_update_permissions(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])

    default_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Ordinary memory", "visibility_mode": "public"},
    ).json()
    meeting_event = client.post(
        "/events",
        headers=auth(token_a),
        json={
            "title": "Meet offline",
            "event_kind": "offline_meeting",
            "visibility_mode": "public",
        },
    ).json()

    assert default_event["event_kind"] == "memory"
    assert meeting_event["event_kind"] == "offline_meeting"

    listed = client.get("/events", headers=auth(token_b)).json()
    listed_by_id = {item["id"]: item for item in listed}
    assert listed_by_id[default_event["id"]]["event_kind"] == "memory"
    assert listed_by_id[meeting_event["id"]]["event_kind"] == "offline_meeting"

    detail = client.get(f"/events/{meeting_event['id']}", headers=auth(token_b)).json()
    assert detail["event_kind"] == "offline_meeting"

    forbidden = client.patch(
        f"/events/{meeting_event['id']}",
        headers=auth(token_b),
        json={"event_kind": "memory"},
    )
    assert forbidden.status_code == 403

    updated = client.patch(
        f"/events/{meeting_event['id']}",
        headers=auth(token_a),
        json={"event_kind": "memory"},
    )
    assert updated.status_code == 200
    assert updated.json()["event_kind"] == "memory"
    assert updated.json()["meeting_session_id"] is None


def test_offline_event_automatically_creates_same_title_meeting(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    created = client.post(
        "/events",
        headers=auth(token),
        json={
            "title": "西湖边散步",
            "event_kind": "offline_meeting",
            "visibility_mode": "public",
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["meeting_session_id"] is not None
    assert payload["meeting_session"]["title"] == "西湖边散步"
    meetings = db_session.execute(select(MeetingSession)).scalars().all()
    assert len(meetings) == 1
    assert meetings[0].title == "西湖边散步"


def test_marking_memory_creates_meeting_and_event_title_stays_independent(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token = str(pair_tokens["user_a_token"])
    event = client.post(
        "/events",
        headers=auth(token),
        json={"title": "第一次去夜市", "visibility_mode": "public"},
    ).json()

    marked = client.patch(
        f"/events/{event['id']}",
        headers=auth(token),
        json={"event_kind": "offline_meeting"},
    )
    assert marked.status_code == 200
    meeting_id = marked.json()["meeting_session_id"]
    assert marked.json()["meeting_session"]["title"] == "第一次去夜市"

    edited = client.patch(
        f"/events/{event['id']}",
        headers=auth(token),
        json={"title": "第一次一起去夜市"},
    )
    renamed = client.patch(
        f"/meeting-sessions/{meeting_id}",
        headers=auth(token),
        json={"title": "夏夜约会"},
    )
    detail = client.get(f"/events/{event['id']}", headers=auth(token)).json()

    assert edited.json()["meeting_session"]["title"] == "第一次去夜市"
    assert renamed.status_code == 200
    assert detail["title"] == "第一次一起去夜市"
    assert detail["meeting_session"]["title"] == "夏夜约会"


def test_unmarking_or_deleting_last_event_removes_empty_meeting(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    first = client.post(
        "/events",
        headers=auth(token),
        json={"title": "短暂见面", "event_kind": "offline_meeting", "visibility_mode": "public"},
    ).json()
    first_meeting_id = first["meeting_session_id"]

    unmarked = client.patch(
        f"/events/{first['id']}",
        headers=auth(token),
        json={"event_kind": "memory"},
    )
    assert unmarked.status_code == 200
    assert db_session.get(MeetingSession, first_meeting_id) is None

    second = client.post(
        "/events",
        headers=auth(token),
        json={"title": "另一场见面", "event_kind": "offline_meeting", "visibility_mode": "public"},
    ).json()
    second_meeting_id = second["meeting_session_id"]
    deleted = client.delete(f"/events/{second['id']}", headers=auth(token))

    assert deleted.status_code == 204
    assert db_session.get(MeetingSession, second_meeting_id) is None


def test_batch_assign_meeting_events_is_atomic_and_cleans_empty_source(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    target_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "周末约会", "event_kind": "offline_meeting", "visibility_mode": "public"},
    ).json()
    moving_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "一起看电影", "event_kind": "offline_meeting", "visibility_mode": "public"},
    ).json()
    ordinary_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "吃了晚饭", "visibility_mode": "public"},
    ).json()
    source_meeting_id = moving_event["meeting_session_id"]

    assigned = client.post(
        f"/meeting-sessions/{target_event['meeting_session_id']}/events",
        headers=auth(token_b),
        json={"event_ids": [moving_event["id"], ordinary_event["id"], ordinary_event["id"]]},
    )

    assert assigned.status_code == 200
    assert assigned.json()["event_count"] == 3
    assert db_session.get(MeetingSession, source_meeting_id) is None
    moved_rows = db_session.execute(
        select(Event).where(Event.id.in_([moving_event["id"], ordinary_event["id"]]))
    ).scalars().all()
    assert all(row.meeting_session_id == target_event["meeting_session_id"] for row in moved_rows)
    assert all(row.event_kind.value == "offline_meeting" for row in moved_rows)

    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "Other A", "user_b_display_name": "Other B"},
    ).json()
    foreign_event = client.post(
        "/events",
        headers=auth(other_pair["user_a_token"]),
        json={"title": "别人的记录", "visibility_mode": "public"},
    ).json()
    before_session_id = db_session.get(Event, ordinary_event["id"]).meeting_session_id
    rejected = client.post(
        f"/meeting-sessions/{target_event['meeting_session_id']}/events",
        headers=auth(token_a),
        json={"event_ids": [ordinary_event["id"], foreign_event["id"]]},
    )

    assert rejected.status_code == 404
    assert db_session.get(Event, ordinary_event["id"]).meeting_session_id == before_session_id


def test_named_meeting_session_groups_multiple_offline_events(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    session = client.post(
        "/meeting-sessions",
        headers=auth(token_a),
        json={"title": "端午杭州三天"},
    ).json()

    first = client.post(
        "/events",
        headers=auth(token_a),
        json={
            "title": "一起吃晚饭",
            "occurred_at": "2026-06-19T19:00:00Z",
            "event_kind": "offline_meeting",
            "meeting_session_id": session["id"],
            "visibility_mode": "public",
        },
    )
    second = client.post(
        "/events",
        headers=auth(token_b),
        json={
            "title": "逛湖边",
            "occurred_at": "2026-06-21T10:00:00Z",
            "event_kind": "offline_meeting",
            "meeting_session_id": session["id"],
            "visibility_mode": "public",
        },
    )
    listed = client.get("/meeting-sessions", headers=auth(token_b)).json()

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["meeting_session"]["title"] == "端午杭州三天"
    assert second.json()["meeting_session_id"] == session["id"]
    assert len(listed) == 1
    assert listed[0]["event_count"] == 2
    assert listed[0]["started_at"] == "2026-06-19T19:00:00Z"
    assert listed[0]["ended_at"] == "2026-06-21T10:00:00Z"


def test_same_day_can_have_two_named_meeting_sessions(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    morning = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "上午短见面"},
    ).json()
    evening = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "晚上约会"},
    ).json()

    client.post(
        "/events",
        headers=auth(token),
        json={
            "title": "上午咖啡",
            "occurred_at": "2026-06-20T10:00:00Z",
            "event_kind": "offline_meeting",
            "meeting_session_id": morning["id"],
            "visibility_mode": "public",
        },
    )
    client.post(
        "/events",
        headers=auth(token),
        json={
            "title": "晚上电影",
            "occurred_at": "2026-06-20T20:00:00Z",
            "event_kind": "offline_meeting",
            "meeting_session_id": evening["id"],
            "visibility_mode": "public",
        },
    )

    listed = client.get("/meeting-sessions", headers=auth(token)).json()
    assert len(listed) == 2
    assert {item["title"]: item["event_count"] for item in listed} == {"上午短见面": 1, "晚上约会": 1}


def test_meeting_session_date_range_is_derived_from_assigned_events(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    session = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "三天小假期", "started_on": "2026-01-01", "ended_on": "2026-01-02"},
    ).json()
    patched = client.patch(
        f"/meeting-sessions/{session['id']}",
        headers=auth(token),
        json={"title": "三天小假期", "started_on": "2026-01-03", "ended_on": "2026-01-04"},
    )
    for day in ("2026-10-01T12:00:00Z", "2026-10-02T12:00:00Z", "2026-10-03T12:00:00Z"):
        response = client.post(
            "/events",
            headers=auth(token),
            json={
                "title": f"假期里的 {day}",
                "occurred_at": day,
                "event_kind": "offline_meeting",
                "meeting_session_id": session["id"],
                "visibility_mode": "public",
            },
        )
        assert response.status_code == 201

    listed = client.get("/meeting-sessions", headers=auth(token)).json()
    row = db_session.get(MeetingSession, session["id"])
    assert patched.status_code == 200
    assert row is not None
    assert row.started_on is None
    assert row.ended_on is None
    assert len(listed) == 1
    assert listed[0]["event_count"] == 3
    assert listed[0]["started_at"] == "2026-10-01T12:00:00Z"
    assert listed[0]["ended_at"] == "2026-10-03T12:00:00Z"


def test_meeting_sessions_are_pair_private_and_memory_events_auto_become_meetings(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token = str(pair_tokens["user_a_token"])
    session = client.post("/meeting-sessions", headers=auth(token), json={"title": "只属于第一对"}).json()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    hidden = client.get("/meeting-sessions", headers=auth(other_pair["user_a_token"]))
    other_session = client.post(
        "/meeting-sessions",
        headers=auth(other_pair["user_a_token"]),
        json={"title": "另一对的见面"},
    ).json()
    own_event = client.post(
        "/events",
        headers=auth(token),
        json={"title": "第一对的小事", "visibility_mode": "public"},
    ).json()

    cross_pair_attach = client.post(
        "/events",
        headers=auth(other_pair["user_a_token"]),
        json={
            "title": "不该挂进去",
            "event_kind": "offline_meeting",
            "meeting_session_id": session["id"],
            "visibility_mode": "public",
        },
    )
    cross_pair_patch = client.patch(
        f"/events/{own_event['id']}",
        headers=auth(token),
        json={"meeting_session_id": other_session["id"]},
    )
    memory_attach = client.post(
        "/events",
        headers=auth(token),
        json={
            "title": "普通小事",
            "event_kind": "memory",
            "meeting_session_id": session["id"],
            "visibility_mode": "public",
        },
    )

    assert hidden.status_code == 200
    assert hidden.json() == []
    assert cross_pair_attach.status_code == 404
    assert cross_pair_patch.status_code == 404
    assert memory_attach.status_code == 201
    assert memory_attach.json()["event_kind"] == "offline_meeting"
    assert memory_attach.json()["meeting_session_id"] == session["id"]


def test_counterpart_can_assign_existing_event_to_meeting_session_without_editing_content(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "待整理的小事", "event_kind": "memory", "visibility_mode": "public"},
    ).json()
    session = client.post("/meeting-sessions", headers=auth(token_b), json={"title": "周末见面"}).json()

    assigned = client.patch(
        f"/events/{event['id']}",
        headers=auth(token_b),
        json={"meeting_session_id": session["id"]},
    )
    forbidden = client.patch(
        f"/events/{event['id']}",
        headers=auth(token_b),
        json={"title": "不能替对方改标题"},
    )

    assert assigned.status_code == 200
    assert assigned.json()["meeting_session_id"] == session["id"]
    assert assigned.json()["event_kind"] == "offline_meeting"
    assert assigned.json()["title"] == "待整理的小事"
    stored_event = db_session.get(Event, event["id"])
    assert stored_event is not None
    assert stored_event.creator_id == pair_tokens["user_a"]["id"]
    assert forbidden.status_code == 403


def test_mutual_submit_unlocks_after_each_side_submits_any_content(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.routes.contents.normalize_voice_to_mp3", lambda data, mime_type: b"mp3-bytes")
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
    assert stored_voice.data is None
    assert stored_voice.storage_backend == "local"
    assert stored_voice.storage_key
    assert stored_voice.storage_key.startswith(f"voices/{pair_tokens['pair_id']}/{event['id']}/")
    assert media_path(stored_voice.storage_key).read_bytes() == b"mp3-bytes"
    assert stored_voice.mime_type == "audio/mpeg"

    after_a = client.get(f"/events/{event['id']}/contents", headers=auth(token_a)).json()
    after_b = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()
    assert after_a["submission_state"]["unlocked"] is True
    assert after_b["submission_state"]["unlocked"] is True
    assert [item["text"] for item in after_a["comments"]] == ["a-comment"]
    assert after_a["voices"][0]["id"] == voice_id
    downloaded = client.get(f"/voices/{voice_id}/file", headers=auth(token_a))
    assert downloaded.status_code == 200
    assert downloaded.content == b"mp3-bytes"
    assert downloaded.headers["content-type"].startswith("audio/mpeg")
    assert downloaded.headers["cache-control"] == "private, max-age=604800"


def test_comment_reactions_follow_mutual_submit_visibility(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Secret reaction", "visibility_mode": "mutual_submit"},
    ).json()
    first_comment = client.post(
        f"/events/{event['id']}/comments",
        headers=auth(token_a),
        json={"text": "hidden until both submit"},
    ).json()

    blocked = client.put(
        f"/comments/{first_comment['id']}/reaction",
        headers=auth(token_b),
        json={"reaction_type": "like"},
    )
    before = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()

    assert blocked.status_code == 403
    assert before["submission_state"] == {
        "current_user_submitted": False,
        "counterpart_submitted": True,
        "unlocked": False,
    }
    assert before["comments"] == []

    client.post(f"/events/{event['id']}/comments", headers=auth(token_b), json={"text": "unlock"})
    reacted = client.put(
        f"/comments/{first_comment['id']}/reaction",
        headers=auth(token_b),
        json={"reaction_type": "like"},
    )
    after_a = client.get(f"/events/{event['id']}/contents", headers=auth(token_a)).json()
    after_b = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()

    assert reacted.status_code == 200
    assert after_a["submission_state"]["unlocked"] is True
    assert after_b["submission_state"]["unlocked"] is True
    assert after_a["comments"][0]["reactions"] == [{"reaction_type": "like", "count": 1, "reacted_by_me": False}]
    assert after_b["comments"][0]["reactions"] == [{"reaction_type": "like", "count": 1, "reacted_by_me": True}]


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
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.routes.contents.normalize_voice_to_mp3", lambda data, mime_type: b"mp3-bytes")
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


def test_mutual_submit_blocks_image_download_until_unlocked(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Image", "visibility_mode": "mutual_submit"},
    ).json()
    upload = client.post(
        f"/events/{event['id']}/images",
        headers=auth(token_a),
        files={"file": ("photo.png", sample_png_bytes(), "image/png")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]

    blocked_full = client.get(f"/images/{image_id}/file", headers=auth(token_b))
    blocked_thumb = client.get(f"/images/{image_id}/thumb", headers=auth(token_b))

    assert blocked_full.status_code == 403
    assert blocked_thumb.status_code == 403


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


def test_legacy_voice_database_data_is_still_downloaded(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    event = client.post(
        "/events",
        headers=auth(token),
        json={"title": "Legacy voice data", "visibility_mode": "public"},
    ).json()
    legacy_voice = Voice(
        event_id=event["id"],
        author_id=int(pair_tokens["user_a"]["id"]),
        file_path="",
        data=b"legacy-mp3",
        duration_ms=1000,
        mime_type="audio/mpeg",
        size_bytes=10,
    )
    db_session.add(legacy_voice)
    db_session.commit()
    db_session.refresh(legacy_voice)

    response = client.get(f"/voices/{legacy_voice.id}/file", headers=auth(token))

    assert response.status_code == 200
    assert response.content == b"legacy-mp3"
    assert response.headers["cache-control"] == "private, max-age=604800"


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


def test_voice_upload_rejects_audio_that_cannot_be_converted(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    from app.media import MediaProcessingError

    def raise_media_error(data: bytes, mime_type: str) -> bytes:
        raise MediaProcessingError("bad audio")

    monkeypatch.setattr("app.api.routes.contents.normalize_voice_to_mp3", raise_media_error)
    event = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"title": "Bad audio", "visibility_mode": "public"},
    ).json()

    response = client.post(
        f"/events/{event['id']}/voices",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("bad.webm", b"bad-audio", "audio/webm")},
    )

    assert response.status_code == 422
    assert db_session.query(Voice).filter(Voice.event_id == event["id"]).count() == 0


def test_image_upload_generates_and_serves_thumbnail(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    original = sample_png_bytes()
    event = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"title": "Photo", "visibility_mode": "public"},
    ).json()

    upload = client.post(
        f"/events/{event['id']}/images",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("photo.png", original, "image/png")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    stored_image = db_session.get(DBImage, image_id)
    assert stored_image is not None
    assert stored_image.data is None
    assert stored_image.thumb_data is None
    assert stored_image.storage_backend == "local"
    assert stored_image.storage_key
    assert stored_image.thumb_storage_key
    assert stored_image.storage_key.startswith(f"images/originals/{pair_tokens['pair_id']}/{event['id']}/")
    assert stored_image.thumb_storage_key.startswith(f"images/thumbs/{pair_tokens['pair_id']}/{event['id']}/")
    assert stored_image.thumb_mime_type == "image/jpeg"
    original_path = media_path(stored_image.storage_key)
    thumb_path = media_path(stored_image.thumb_storage_key)
    assert original_path.read_bytes() == original
    assert thumb_path.is_file()
    assert stored_image.thumb_size_bytes == thumb_path.stat().st_size

    thumb = client.get(f"/images/{image_id}/thumb", headers=auth(str(pair_tokens["user_a_token"])))
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/jpeg")
    assert thumb.headers["cache-control"] == "private, max-age=604800"
    assert thumb.content == thumb_path.read_bytes()

    full = client.get(f"/images/{image_id}/file", headers=auth(str(pair_tokens["user_a_token"])))
    assert full.status_code == 200
    assert full.headers["content-type"].startswith("image/png")
    assert full.headers["cache-control"] == "private, max-age=604800"
    assert full.content == original


def test_legacy_image_thumbnail_is_generated_lazily(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    original = sample_png_bytes()
    event = client.post(
        "/events",
        headers=auth(token),
        json={"title": "Old photo", "visibility_mode": "public"},
    ).json()
    legacy_image = DBImage(
        event_id=event["id"],
        author_id=int(pair_tokens["user_a"]["id"]),
        file_path="",
        data=original,
        thumb_data=None,
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=0,
        mime_type="image/png",
        size_bytes=100,
    )
    db_session.add(legacy_image)
    db_session.commit()
    db_session.refresh(legacy_image)

    response = client.get(f"/images/{legacy_image.id}/thumb", headers=auth(token))

    assert response.status_code == 200
    db_session.refresh(legacy_image)
    assert legacy_image.thumb_data
    assert response.content == legacy_image.thumb_data

    full = client.get(f"/images/{legacy_image.id}/file", headers=auth(token))
    assert full.status_code == 200
    assert full.headers["cache-control"] == "private, max-age=604800"
    assert full.content == original


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
    assert response.json()["logs"][0]["source"] == "empty"


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
    assert dashboard["logs"][0]["source"] == "empty"


def test_cycle_dashboard_keeps_unrecorded_past_empty_and_today_predicted(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    response = client.get(
        "/cycles/dashboard?start=2026-05-20&end=2026-05-22",
        headers=auth(str(pair_tokens["user_a_token"])),
    )

    assert response.status_code == 200
    logs = response.json()["logs"]
    assert [(log["date"], log["source"], log["phase"], log["is_period"]) for log in logs] == [
        ("2026-05-20", "empty", "unknown", False),
        ("2026-05-21", "empty", "unknown", False),
        ("2026-05-22", "predicted", "luteal", False),
    ]


def test_cycle_dashboard_predicts_past_non_period_and_future_unrecorded_days(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])
    client.put(
        "/cycles/logs/2026-05-20",
        headers=auth(token),
        json={"phase": "menstrual", "is_period": True, "flow": "medium"},
    )

    response = client.get("/cycles/dashboard?start=2026-05-20&end=2026-05-23", headers=auth(token))

    assert response.status_code == 200
    logs = {log["date"]: log for log in response.json()["logs"]}
    assert logs["2026-05-20"]["source"] == "recorded"
    assert logs["2026-05-21"]["source"] == "predicted"
    assert logs["2026-05-21"]["is_period"] is False
    assert logs["2026-05-21"]["phase"] == "follicular"
    assert logs["2026-05-22"]["source"] == "predicted"
    assert logs["2026-05-22"]["is_period"] is True
    assert logs["2026-05-22"]["phase"] == "menstrual"
    assert logs["2026-05-23"]["source"] == "predicted"


def test_cycle_non_period_submission_stores_fact_not_client_phase(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 2, 15))
    token = str(pair_tokens["user_a_token"])
    for start in ["2026-01-01", "2026-01-29"]:
        client.put(
            f"/cycles/logs/{start}",
            headers=auth(token),
            json={"phase": "menstrual", "is_period": True, "flow": "medium"},
        )

    created = client.put(
        "/cycles/logs/2026-02-10",
        headers=auth(token),
        json={"phase": "ovulation", "is_period": False, "flow": "none"},
    )

    assert created.status_code == 200
    assert created.json()["phase"] == "unknown"
    stored = db_session.execute(
        select(CycleDailyLog).where(CycleDailyLog.pair_id == pair_tokens["pair_id"], CycleDailyLog.date == date(2026, 2, 10))
    ).scalar_one()
    assert stored.phase == CyclePhase.unknown
    assert stored.is_period is False

    dashboard = client.get("/cycles/dashboard?start=2026-02-10&end=2026-02-10", headers=auth(token)).json()
    log = dashboard["logs"][0]
    assert log["source"] == "recorded"
    assert log["is_period"] is False
    assert log["phase"] == "fertile"


def test_cycle_recorded_non_period_fact_overrides_predicted_period_window(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])
    client.put(
        "/cycles/logs/2026-05-20",
        headers=auth(token),
        json={"phase": "menstrual", "is_period": True, "flow": "medium"},
    )
    client.put(
        "/cycles/logs/2026-05-21",
        headers=auth(token),
        json={"phase": "menstrual", "is_period": False, "flow": "none"},
    )

    dashboard = client.get("/cycles/dashboard?start=2026-05-20&end=2026-05-21", headers=auth(token)).json()
    logs = {log["date"]: log for log in dashboard["logs"]}

    assert logs["2026-05-20"]["phase"] == "menstrual"
    assert logs["2026-05-21"]["source"] == "recorded"
    assert logs["2026-05-21"]["is_period"] is False
    assert logs["2026-05-21"]["phase"] == "follicular"


def test_cycle_dashboard_write_returns_recomputed_prediction(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 3, 25))
    token = str(pair_tokens["user_a_token"])
    for start in ["2026-01-29", "2026-02-26"]:
        client.put(
            f"/cycles/logs/{start}",
            headers=auth(token),
            json={"phase": "menstrual", "is_period": True, "flow": "medium"},
        )
    before = client.get("/cycles/dashboard?start=2026-03-01&end=2026-04-30", headers=auth(token)).json()
    assert before["stats"]["next_period_start"] == "2026-03-26"

    updated = client.put(
        "/cycles/logs/2026-03-25/dashboard?start=2026-03-01&end=2026-04-30",
        headers=auth(token),
        json={"phase": "menstrual", "is_period": True, "flow": "medium"},
    )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["stats"]["last_period_start"] == "2026-03-25"
    assert payload["stats"]["next_period_start"] == "2026-04-22"
    assert next(log for log in payload["logs"] if log["date"] == "2026-03-25")["source"] == "recorded"


def test_cycle_prediction_filters_unreasonable_cycle_gaps(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 3, 21))
    token = str(pair_tokens["user_a_token"])
    for start in ["2026-01-01", "2026-01-29", "2026-03-20"]:
        client.put(
            f"/cycles/logs/{start}",
            headers=auth(token),
            json={"phase": "menstrual", "is_period": True, "flow": "medium"},
        )

    dashboard = client.get("/cycles/dashboard?start=2026-03-01&end=2026-04-30", headers=auth(token)).json()

    assert dashboard["stats"]["average_cycle_length"] == 28
    assert dashboard["stats"]["last_period_start"] == "2026-03-20"
    assert dashboard["stats"]["next_period_start"] == "2026-04-17"


def test_cycle_prediction_weights_recent_cycles(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 7, 7))
    token = str(pair_tokens["user_a_token"])
    for start in ["2026-01-01", "2026-01-29", "2026-02-26", "2026-03-26", "2026-04-29", "2026-06-02", "2026-07-06"]:
        client.put(
            f"/cycles/logs/{start}",
            headers=auth(token),
            json={"phase": "menstrual", "is_period": True, "flow": "medium"},
        )

    dashboard = client.get("/cycles/dashboard?start=2026-07-01&end=2026-08-31", headers=auth(token)).json()

    assert dashboard["stats"]["average_cycle_length"] == 32
    assert dashboard["stats"]["next_period_start"] == "2026-08-07"


def test_todo_dashboard_requires_login_and_seeds_default_play_items(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    assert client.get("/todos/dashboard?month=2026-05").status_code == 401

    response = client.get("/todos/dashboard?month=2026-05", headers=auth(str(pair_tokens["user_a_token"])))

    assert response.status_code == 200
    assert response.json()["llm_enabled"] is False
    titles = [item["title"] for item in response.json()["items"] if item["category"] == "play"]
    assert titles == ["拼乐高", "看电影", "台球", "唱歌"]


def test_admin_ai_enable_validates_before_turning_on(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.admin.ensure_llm_ready", lambda db: None)
    payload = {
        "llm_enabled": True,
        "protocol": "openai",
        "selected_model": "gpt-test",
        "openai_base_url": "https://llm.example/v1",
        "anthropic_base_url": "https://anthropic.example",
        "api_key": "test-key",
        "amap_api_key": "",
    }

    response = client.patch("/admin/ai-config", headers={"X-Admin-Key": "test-admin-key"}, json=payload)

    assert response.status_code == 200
    assert response.json()["llm_enabled"] is True


def test_admin_ai_enable_failure_turns_off(client: TestClient, monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    def fail_ready(db: Session) -> None:
        raise RuntimeError("bad key")

    monkeypatch.setattr("app.api.routes.admin.ensure_llm_ready", fail_ready)
    payload = {
        "llm_enabled": True,
        "protocol": "openai",
        "selected_model": "gpt-test",
        "openai_base_url": "https://llm.example/v1",
        "anthropic_base_url": "https://anthropic.example",
        "api_key": "bad-key",
        "amap_api_key": "",
    }

    response = client.patch("/admin/ai-config", headers={"X-Admin-Key": "test-admin-key"}, json=payload)

    assert response.status_code == 502
    assert db_session.get(AISetting, 1).llm_enabled is False


def test_todo_candidate_ai_off_uses_manual_category_without_llm(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("LLM should not run")))
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [{"amap_poi_id": "FOOD1", "name": "Manual Cafe", "address": "A"}],
    )

    created = client.post(
        "/todos/candidates",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"raw_title": "Manual Cafe", "category": "food"},
    )

    assert created.status_code == 201
    assert created.json()["category"] == "food"


def test_todo_candidate_ai_failure_turns_off_and_falls_back_to_manual_category(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch, db_session: Session
) -> None:
    db_session.add(
        AISetting(
            id=1,
            llm_enabled=True,
            protocol="openai",
            selected_model="gpt-test",
            openai_base_url="https://llm.example/v1",
            anthropic_base_url="https://anthropic.example",
            api_key="bad-key",
            amap_api_key="",
        )
    )
    db_session.commit()
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("LLM down")))
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [{"amap_poi_id": "PLAY1", "name": "Manual Play", "address": "B"}],
    )

    created = client.post(
        "/todos/candidates",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"raw_title": "Manual Play", "category": "play"},
    )

    assert created.status_code == 201
    assert created.json()["category"] == "play"
    assert db_session.get(AISetting, 1).llm_enabled is False


def test_todo_items_are_pair_isolated(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    created = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "看展"},
    ).json()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()

    assert client.get(f"/todos/items/{created['id']}", headers=auth(other_pair["user_a_token"])).status_code == 404


def test_todo_schedule_commits_without_email(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, str]] = []

    def fake_send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
        sent.append({"to": to, "subject": subject, "text": text_body, "html": html_body or ""})
        return True

    monkeypatch.setattr("app.emailer.send_email", fake_send_email)
    pair_tokens = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "user_a_display_name": "A",
            "user_b_display_name": "B",
            "user_a_email": "a@example.com",
            "user_b_email": "b@example.com",
        },
    ).json()
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "看电影"},
    ).json()

    scheduled = client.post(
        f"/todos/items/{item['id']}/schedules",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"scheduled_on": "2026-05-20"},
    )

    assert scheduled.status_code == 201
    dashboard = client.get("/todos/dashboard?month=2026-05", headers=auth(str(pair_tokens["user_b_token"]))).json()
    assert any(schedule["item_id"] == item["id"] for schedule in dashboard["schedules"])
    assert sent == []

def test_todo_restaurant_search_and_create_use_amap_mcp(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {
                "amap_poi_id": "B001",
                "name": "小馆",
                "address": "幸福路 1 号",
                "location": "120.1,30.2",
                "city": city,
                "poi_type": "餐饮服务",
                "tel": "123",
                "business_area": "中心",
                "raw": {"id": "B001"},
            }
        ],
    )
    monkeypatch.setattr(
        "app.amap_mcp.restaurant_detail",
        lambda poi_id, amap_key=None: {
            "amap_poi_id": poi_id,
            "name": "小馆",
            "rating": 4.8,
            "raw": {"id": poi_id, "rating": "4.8"},
        },
    )

    search = client.post(
        "/todos/restaurants/search",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"keyword": "小馆", "city": "杭州"},
    )
    assert search.status_code == 200
    candidate = search.json()["candidates"][0]
    created = client.post(
        "/todos/restaurants",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"candidate": candidate, "signature_dishes": "红烧肉", "per_capita": 88},
    )

    assert created.status_code == 201
    data = created.json()
    assert data["category"] == "food"
    assert data["restaurant"]["parse_status"] == "resolved"
    assert data["restaurant"]["signature_dishes"] == "红烧肉"
    assert data["restaurant"]["rating"] == 4.8


def test_todo_restaurant_create_auto_saves_rich_amap_detail(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {
                "amap_poi_id": "B0G2HCOEAE",
                "name": "陈记川菜馆（汇银中心店）",
                "address": "杭州市余杭区联创街 77 号汇银中心 F1 层",
                "location": "120.027121,30.288808",
                "city": "杭州市",
                "adname": "余杭区",
                "pname": "浙江省",
                "poi_type": "餐饮服务;中餐厅;四川菜(川菜)",
                "poi_typecode": "050102",
                "business_area": "五常街道",
                "raw": {"id": "B0G2HCOEAE"},
            }
        ],
    )
    monkeypatch.setattr(
        "app.amap_mcp.restaurant_detail",
        lambda poi_id, amap_key=None: {
            "amap_poi_id": poi_id,
            "name": "陈记川菜馆（汇银中心店）",
            "address": "杭州市余杭区联创街 77 号汇银中心 F1 层",
            "location": "120.027121,30.288808",
            "city": "杭州市",
            "adname": "余杭区",
            "pname": "浙江省",
            "poi_type": "餐饮服务;中餐厅;四川菜(川菜)",
            "poi_typecode": "050102",
            "business_area": "五常街道",
            "rating": 4.4,
            "per_capita": 69,
            "opening_hours": "周一至周日 11:00-23:00",
            "meal_ordering": "0",
            "signature_dishes": "川菜, 四川菜",
            "photos_count": 1,
            "first_photo_url": "https://aos-comment.amap.com/B0G2HCOEAE/comment/photo.jpg",
            "amap_navigation_url": "https://uri.amap.com/marker?position=120.027121,30.288808&name=%E9%99%88%E8%AE%B0",
            "raw": {"id": poi_id, "biz_ext": {"rating": "4.4", "cost": "69", "open_time": "周一至周日 11:00-23:00", "meal_ordering": "0"}},
        },
    )

    search = client.post(
        "/todos/restaurants/search",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"keyword": "陈记川菜馆（汇银中心店）", "city": "杭州"},
    )
    candidate = search.json()["candidates"][0]
    created = client.post("/todos/restaurants", headers=auth(str(pair_tokens["user_a_token"])), json={"candidate": candidate})

    assert created.status_code == 201
    restaurant = created.json()["restaurant"]
    assert restaurant["amap_poi_id"] == "B0G2HCOEAE"
    assert restaurant["rating"] == 4.4
    assert restaurant["per_capita"] == 69
    assert restaurant["opening_hours"] == "周一至周日 11:00-23:00"
    assert restaurant["meal_ordering"] == "0"
    assert restaurant["first_photo_url"].startswith("https://aos-comment.amap.com/")
    assert restaurant["amap_navigation_url"].startswith("https://uri.amap.com/marker")
    assert any(fact["label"] == "地图导航" and fact["href"] for fact in restaurant["display_facts"])


def test_todo_restaurant_create_keeps_candidate_when_detail_fails(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    from app.amap_mcp import AmapMCPError

    candidate = {
        "amap_poi_id": "B001",
        "name": "小馆",
        "address": "幸福路 1 号",
        "location": "120.1,30.2",
        "city": "杭州",
        "poi_type": "餐饮服务",
        "business_area": "中心",
        "raw": {"id": "B001"},
    }
    monkeypatch.setattr("app.amap_mcp.restaurant_detail", lambda poi_id, amap_key=None: (_ for _ in ()).throw(AmapMCPError("detail failed")))

    created = client.post("/todos/restaurants", headers=auth(str(pair_tokens["user_a_token"])), json={"candidate": candidate})

    assert created.status_code == 201
    restaurant = created.json()["restaurant"]
    assert restaurant["name"] == "小馆"
    assert restaurant["parse_status"] == "failed"
    assert "detail failed" in restaurant["parse_error"]


def test_todo_search_uses_saved_location_nearby_first_and_text_fallback(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.api.routes.auth.amap_mcp.regeocode_location",
        lambda location, amap_key=None: {"city": "杭州市", "district": "余杭区"},
    )
    client.patch(
        "/auth/me/location",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"coords": "120.027121,30.288808"},
    )
    monkeypatch.setattr(
        "app.amap_mcp.search_pois_nearby",
        lambda location, radius_m=5000, keyword="", amap_key=None: [
            {"amap_poi_id": "NEAR2", "name": "近处酒店 B", "address": "B", "distance_m": 800, "rating": 4.9},
            {"amap_poi_id": "NEAR1", "name": "近处酒店 A", "address": "A", "distance_m": 300, "rating": 4.1},
        ],
    )
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {"amap_poi_id": "NEAR1", "name": "重复酒店", "address": "A"},
            {"amap_poi_id": "TEXT1", "name": "文本酒店", "address": city},
        ],
    )

    response = client.post(
        "/todos/restaurants/search",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"keyword": "酒店"},
    )

    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert [candidate["amap_poi_id"] for candidate in candidates] == ["NEAR1", "NEAR2", "TEXT1"]
    assert candidates[0]["distance_m"] == 300


def test_todo_search_without_location_falls_back_to_text_search(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.amap_mcp.search_pois_nearby",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("nearby search should not run")),
    )
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [{"amap_poi_id": "TEXT1", "name": "文本餐厅", "address": city}],
    )

    response = client.post(
        "/todos/restaurants/search",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"keyword": "餐厅", "city": "杭州"},
    )

    assert response.status_code == 200
    assert response.json()["candidates"][0]["amap_poi_id"] == "TEXT1"


def test_todo_candidate_food_ready_confirms_to_rich_restaurant(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "food")
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {
                "amap_poi_id": "B0G2HCOEAE",
                "name": "陈记川菜馆（汇银中心店）",
                "address": "汇银中心 F1",
                "location": "120.027121,30.288808",
                "city": "杭州市",
                "poi_type": "餐饮服务;中餐厅;四川菜",
                "per_capita": 69,
            }
        ],
    )
    monkeypatch.setattr(
        "app.amap_mcp.restaurant_detail",
        lambda poi_id, amap_key=None: {
            "amap_poi_id": poi_id,
            "name": "陈记川菜馆（汇银中心店）",
            "address": "杭州市余杭区联创街 77 号汇银中心 F1 层",
            "location": "120.027121,30.288808",
            "city": "杭州市",
            "business_area": "五常街道",
            "poi_type": "餐饮服务;中餐厅;四川菜/川菜",
            "rating": 4.4,
            "per_capita": 69,
            "opening_hours": "周一至周日 11:00-23:00",
            "meal_ordering": "0",
            "raw": {"id": poi_id},
        },
    )

    created = client.post(
        "/todos/candidates",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"raw_title": "陈记川菜馆（汇银中心店）", "category": "food"},
    )
    assert created.status_code == 201
    assert created.json()["status"] == "ready"
    assert created.json()["category"] == "food"
    confirmed = client.post(
        f"/todos/candidates/{created.json()['id']}/confirm",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={},
    )

    assert confirmed.status_code == 201
    data = confirmed.json()
    assert data["category"] == "food"
    assert data["restaurant"]["rating"] == 4.4
    assert data["restaurant"]["opening_hours"] == "周一至周日 11:00-23:00"


def test_todo_candidate_multiple_amap_choices_can_confirm_selected(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "play")
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {"amap_poi_id": "B001", "name": "浩波台球俱乐部 A", "address": "A"},
            {"amap_poi_id": "B002", "name": "浩波台球俱乐部(汇银中心店)", "address": "汇银中心"},
        ],
    )
    monkeypatch.setattr("app.amap_mcp.restaurant_detail", lambda poi_id, amap_key=None: {"amap_poi_id": poi_id, "name": "浩波台球俱乐部(汇银中心店)", "raw": {"id": poi_id}})

    created = client.post("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])), json={"raw_title": "浩波台球俱乐部", "category": "play"})
    body = created.json()
    assert body["status"] == "needs_choice"
    confirmed = client.post(
        f"/todos/candidates/{body['id']}/confirm",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"selected_candidate": body["amap_candidates"][1]},
    )

    assert confirmed.status_code == 201
    assert confirmed.json()["category"] == "play"
    assert confirmed.json()["restaurant"]["amap_poi_id"] == "B002"
    remaining = client.get("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])))
    assert remaining.status_code == 200
    assert remaining.json() == []


def test_todo_candidate_single_play_poi_confirms_and_removes_candidate(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "play")
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {
                "amap_poi_id": "PLAY001",
                "name": "Haobo Billiards Club",
                "address": "Huiyin Center",
                "poi_type": "Sports;Billiards",
            }
        ],
    )
    monkeypatch.setattr(
        "app.amap_mcp.restaurant_detail",
        lambda poi_id, amap_key=None: {
            "amap_poi_id": poi_id,
            "name": "Haobo Billiards Club",
            "address": "Huiyin Center",
            "poi_type": "Sports;Billiards",
            "raw": {"id": poi_id},
        },
    )

    created = client.post("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])), json={"raw_title": "Haobo Billiards Club", "category": "play"})
    body = created.json()
    confirmed = client.post(f"/todos/candidates/{body['id']}/confirm", headers=auth(str(pair_tokens["user_a_token"])), json={})
    remaining = client.get("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])))

    assert created.status_code == 201
    assert body["status"] == "ready"
    assert confirmed.status_code == 201
    assert confirmed.json()["category"] == "play"
    assert confirmed.json()["restaurant"]["amap_poi_id"] == "PLAY001"
    assert remaining.status_code == 200
    assert remaining.json() == []


def test_todo_candidate_confirm_can_override_category(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "play")
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [{"amap_poi_id": "STAY001", "name": "Haiyou Hotel", "address": "Alibaba HQ"}],
    )
    monkeypatch.setattr(
        "app.amap_mcp.restaurant_detail",
        lambda poi_id, amap_key=None: {"amap_poi_id": poi_id, "name": "Haiyou Hotel", "raw": {"id": poi_id}},
    )

    created = client.post("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])), json={"raw_title": "Haiyou Hotel", "category": "stay"})
    confirmed = client.post(
        f"/todos/candidates/{created.json()['id']}/confirm",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "stay"},
    )

    assert confirmed.status_code == 201
    assert confirmed.json()["category"] == "stay"
    assert confirmed.json()["restaurant"]["amap_poi_id"] == "STAY001"


def test_todo_candidate_confirm_detail_crash_returns_502_and_keeps_candidate(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "play")
    monkeypatch.setattr(
        "app.amap_mcp.search_restaurants",
        lambda keyword, city=None, amap_key=None: [{"amap_poi_id": "CRASH001", "name": "Crash Billiards", "address": "Huiyin Center"}],
    )
    monkeypatch.setattr("app.amap_mcp.restaurant_detail", lambda poi_id, amap_key=None: (_ for _ in ()).throw(RuntimeError("detail crashed")))

    created = client.post("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])), json={"raw_title": "Crash Billiards", "category": "play"})
    failed = client.post(f"/todos/candidates/{created.json()['id']}/confirm", headers=auth(str(pair_tokens["user_a_token"])), json={})
    remaining = client.get("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])))

    assert failed.status_code == 502
    assert "Todo candidate confirmation failed" in failed.json()["detail"]
    assert [candidate["id"] for candidate in remaining.json()] == [created.json()["id"]]


def test_todo_candidate_wish_skips_amap_and_confirms_plain_item(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    called = False
    monkeypatch.setattr("app.api.routes.todos.complete_todo_category", lambda db, title: "wish")

    def fake_search(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr("app.amap_mcp.search_restaurants", fake_search)

    created = client.post("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])), json={"raw_title": "想要一束花", "category": "wish"})
    assert created.json()["category"] == "wish"
    assert created.json()["status"] == "ready"
    confirmed = client.post(f"/todos/candidates/{created.json()['id']}/confirm", headers=auth(str(pair_tokens["user_a_token"])), json={})

    assert called is False
    assert confirmed.status_code == 201
    assert confirmed.json()["category"] == "wish"
    assert confirmed.json()["restaurant"] is None


def test_todo_direct_wish_create_does_not_call_candidate_search(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_search(*args, **kwargs):
        raise AssertionError("wish item creation should not call AMap candidate search")

    monkeypatch.setattr("app.api.routes.todos._search_location_aware_pois", fail_search)

    created = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "wish", "title": "想要一束花"},
    )
    candidates = client.get("/todos/candidates", headers=auth(str(pair_tokens["user_a_token"])))

    assert created.status_code == 201
    assert created.json()["category"] == "wish"
    assert created.json()["restaurant"] is None
    assert candidates.json() == []


def test_todo_schedule_replaces_existing_date(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "看展"},
    ).json()

    first = client.post(f"/todos/items/{item['id']}/schedules", headers=auth(str(pair_tokens["user_a_token"])), json={"scheduled_on": "2026-05-20"})
    second = client.post(f"/todos/items/{item['id']}/schedules", headers=auth(str(pair_tokens["user_a_token"])), json={"scheduled_on": "2026-05-21"})
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"]))).json()

    assert first.status_code == 201
    assert second.status_code == 201
    assert [schedule["scheduled_on"] for schedule in detail["schedules"]] == ["2026-05-21"]


def test_todo_detail_returns_saved_schedule_date(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "wish", "title": "一起去看日落"},
    ).json()

    scheduled = client.post(
        f"/todos/items/{item['id']}/schedules",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"scheduled_on": "2026-06-01"},
    )
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_b_token"])))

    assert scheduled.status_code == 201
    assert detail.status_code == 200
    assert detail.json()["schedules"][0]["scheduled_on"] == "2026-06-01"


def test_todo_weather_hint_returns_forecast_and_silently_degrades(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.amap_mcp.restaurant_detail", lambda poi_id, amap_key=None: {"id": poi_id})
    item = client.post(
        "/todos/restaurants",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={
            "candidate": {
                "amap_poi_id": "B-WEATHER",
                "name": "天气餐厅",
                "address": "未来科技城",
                "location": "120.1,30.2",
                "city": "杭州市",
            }
        },
    ).json()
    client.post(
        f"/todos/items/{item['id']}/schedules",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"scheduled_on": "2026-06-12"},
    )
    monkeypatch.setattr(
        "app.amap_mcp.weather_for_city",
        lambda city, amap_key=None: {
            "city": city,
            "forecasts": [
                {"date": "2026-06-11", "dayweather": "阴"},
                {
                    "date": "2026-06-12",
                    "dayweather": "晴",
                    "nightweather": "多云",
                    "daytemp": "30",
                    "nighttemp": "24",
                    "daywind": "东",
                    "nightwind": "东南",
                },
            ],
        },
    )

    weather = client.get(f"/todos/items/{item['id']}/weather", headers=auth(str(pair_tokens["user_a_token"])))

    from app.amap_mcp import AmapMCPError

    monkeypatch.setattr(
        "app.amap_mcp.weather_for_city",
        lambda city, amap_key=None: (_ for _ in ()).throw(AmapMCPError("weather failed")),
    )
    degraded = client.get(f"/todos/items/{item['id']}/weather", headers=auth(str(pair_tokens["user_a_token"])))

    assert weather.status_code == 200
    assert weather.json()["city"] == "杭州市"
    assert weather.json()["report_date"] == "2026-06-12"
    assert weather.json()["day_weather"] == "晴"
    assert degraded.status_code == 200
    assert degraded.json() is None


def test_amap_mcp_resolves_windows_npx_through_cmd(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import amap_mcp

    monkeypatch.setattr(amap_mcp.shutil, "which", lambda name: "C:\\Program Files\\nodejs\\npx.cmd" if name == "npx.cmd" else None)
    monkeypatch.setattr(amap_mcp.sys, "platform", "win32")
    monkeypatch.setenv("COMSPEC", "C:\\Windows\\System32\\cmd.exe")

    assert amap_mcp._npx_command() == ["C:\\Windows\\System32\\cmd.exe", "/d", "/s", "/c", "npx"]


def test_todo_restaurant_detail_requires_both_users_to_comment_and_images_do_not_complete(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.amap_mcp.restaurant_detail", lambda poi_id, amap_key=None: {"id": poi_id})
    item = client.post(
        "/todos/restaurants",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={
            "candidate": {
                "amap_poi_id": "B002",
                "name": "打卡餐厅",
                "address": "幸福路 2 号",
                "location": "120.1,30.2",
                "city": "杭州",
                "poi_type": "餐饮服务",
                "tel": None,
                "business_area": None,
                "raw": {},
            }
        },
    ).json()
    comment = client.post(
        f"/todos/items/{item['id']}/comments",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"text": "吃完啦"},
    )

    assert comment.status_code == 201
    assert comment.json()["author_display_name"] == "A"
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_b_token"]))).json()
    assert detail["checked_in"] is False
    assert detail["comments"][0]["text"] == "吃完啦"
    assert detail["comments"][0]["author_display_name"] == "A"

    second_comment = client.post(
        f"/todos/items/{item['id']}/comments",
        headers=auth(str(pair_tokens["user_b_token"])),
        json={"text": "我也写了"},
    )

    assert second_comment.status_code == 201
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"]))).json()
    assert detail["checked_in"] is True

    image_only_item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "只传照片"},
    ).json()

    upload = client.post(
        f"/todos/items/{image_only_item['id']}/images",
        headers=auth(str(pair_tokens["user_b_token"])),
        files={"file": ("photo.png", sample_png_bytes(), "image/png")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    assert client.get(f"/todo-images/{image_id}/thumb", headers=auth(str(pair_tokens["user_a_token"]))).status_code == 200
    image_only_detail = client.get(f"/todos/items/{image_only_item['id']}", headers=auth(str(pair_tokens["user_a_token"]))).json()
    assert image_only_detail["checked_in"] is False


def test_todo_note_does_not_complete_item(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "wish", "title": "想要一束花"},
    ).json()

    updated = client.patch(
        f"/todos/items/{item['id']}",
        headers=auth(str(pair_tokens["user_b_token"])),
        json={"note": "先写在描述里，不算打卡"},
    )
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"])))

    assert updated.status_code == 200
    assert updated.json()["note"] == "先写在描述里，不算打卡"
    assert updated.json()["checked_in"] is False
    assert detail.json()["comments"] == []
    assert detail.json()["checked_in"] is False


def test_todo_image_full_view_and_pair_delete(client: TestClient, pair_tokens: dict[str, str | int], db_session: Session) -> None:
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "上传照片"},
    ).json()
    upload = client.post(
        f"/todos/items/{item['id']}/images",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("photo.png", sample_png_bytes(), "image/png")},
    )
    image_id = upload.json()["id"]
    stored_image = db_session.get(TodoImage, image_id)
    assert stored_image is not None
    original_path = media_path(stored_image.storage_key)
    thumb_path = media_path(stored_image.thumb_storage_key)

    full = client.get(f"/todo-images/{image_id}/file", headers=auth(str(pair_tokens["user_b_token"])))
    thumb = client.get(f"/todo-images/{image_id}/thumb", headers=auth(str(pair_tokens["user_b_token"])))
    assert original_path.is_file()
    assert thumb_path.is_file()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    blocked = client.delete(f"/todo-images/{image_id}", headers=auth(other_pair["user_a_token"]))
    deleted = client.delete(f"/todo-images/{image_id}", headers=auth(str(pair_tokens["user_b_token"])))
    detail = client.get(f"/todos/items/{item['id']}", headers=auth(str(pair_tokens["user_a_token"]))).json()

    assert full.status_code == 200
    assert full.headers["content-type"].startswith("image/png")
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/jpeg")
    assert blocked.status_code == 404
    assert deleted.status_code == 204
    assert detail["images"] == []
    assert client.get(f"/todo-images/{image_id}/file", headers=auth(str(pair_tokens["user_a_token"]))).status_code == 404
    assert client.get(f"/todo-images/{image_id}/thumb", headers=auth(str(pair_tokens["user_a_token"]))).status_code == 404
    assert not original_path.exists()
    assert not thumb_path.exists()


def test_todo_classify_uses_llm_result_and_stays_pair_isolated(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.routes.todos.classify_todo_category", lambda db, item: "food")
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "火锅"},
    ).json()

    classified = client.post(f"/todos/items/{item['id']}/classify", headers=auth(str(pair_tokens["user_a_token"])))

    assert classified.status_code == 200
    assert classified.json()["category"] == "food"

    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    assert client.post(f"/todos/items/{item['id']}/classify", headers=auth(other_pair["user_a_token"])).status_code == 404


def test_todo_batch_classify_only_updates_open_items(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def classify_open_only(db: Session, item) -> str:
        calls.append(item.title)
        if item.title == "completed hotpot":
            raise AssertionError("completed todo should not be classified")
        return "food"

    monkeypatch.setattr("app.api.routes.todos.classify_todo_category", classify_open_only)
    open_item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "open hotpot"},
    ).json()
    completed_item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "completed hotpot"},
    ).json()
    client.post(
        f"/todos/items/{completed_item['id']}/comments",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"text": "done by a"},
    )
    client.post(
        f"/todos/items/{completed_item['id']}/comments",
        headers=auth(str(pair_tokens["user_b_token"])),
        json={"text": "done by b"},
    )

    response = client.post("/todos/items/classify-open", headers=auth(str(pair_tokens["user_a_token"])))

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert calls == ["open hotpot"]
    items = {item["id"]: item for item in client.get("/todos/dashboard?month=2026-05", headers=auth(str(pair_tokens["user_a_token"]))).json()["items"]}
    assert items[open_item["id"]]["category"] == "food"
    assert items[completed_item["id"]]["category"] == "play"
    assert items[completed_item["id"]]["checked_in"] is True


def test_todo_classify_reports_missing_llm_config(client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_classify(db: Session, item) -> str:
        raise RuntimeError("LLM API key or model is not configured")

    monkeypatch.setattr("app.api.routes.todos.classify_todo_category", fail_classify)
    item = client.post(
        "/todos/items",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"category": "play", "title": "火锅"},
    ).json()

    classified = client.post(f"/todos/items/{item['id']}/classify", headers=auth(str(pair_tokens["user_a_token"])))

    assert classified.status_code == 502


def test_admin_ai_config_edits_keys_lists_models_and_saves_model(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    settings.llm_api_key = "secret-token-1234"
    settings.amap_maps_api_key = "amap-secret-5678"
    settings.llm_model = "mimo-v2.5-pro"
    monkeypatch.setattr("app.api.routes.admin.list_models", lambda db, protocol: ["mimo-v2.5-pro", "other-model"])
    monkeypatch.setattr(
        "app.api.routes.admin.test_category_completion",
        lambda db, keyword="江西小炒(西溪北苑东区店)", city=None, expected_category="food": {
            "category": "food",
            "sample_keyword": "江西小炒(西溪北苑东区店)",
            "sample_city": city,
            "expected_category": expected_category,
            "category_matched": True,
            "amap_name": "江西小炒(西溪北苑东区店)",
            "amap_address": "西溪北苑东区",
            "amap_poi_type": "050000",
            "amap_poi_typecode": "050000",
            "amap_poi_id": "B001",
            "amap_city": "杭州市",
            "amap_adname": "余杭区",
            "amap_tel": "0571-00000000",
            "amap_business_area": "西溪",
            "rating": 4.6,
            "per_capita": 58,
            "tags": ["江西菜", "小炒"],
            "signature_dishes": "江西菜, 小炒",
            "photos_count": 2,
            "first_photo_url": "https://example.com/a.jpg",
            "amap_category": "food",
            "amap_category_reason": "AMap POI type/name indicates food service: 050000",
            "llm_category": None,
            "llm_status": "failed",
            "llm_message": "LLM returned empty category text",
            "evidence_note": "AMap evidence",
        },
    )

    config = client.get("/admin/ai-config", headers={"X-Admin-Key": "test-admin-key"})
    assert config.status_code == 200
    assert config.json()["api_key"] == "secret-token-1234"
    assert config.json()["api_key_preview"] == "secr***1234"
    assert config.json()["amap_api_key"] == "amap-secret-5678"
    assert config.json()["amap_key_preview"] == "amap***5678"

    updated = client.patch(
        "/admin/ai-config",
        headers={"X-Admin-Key": "test-admin-key"},
        json={
            "protocol": "anthropic",
            "selected_model": "other-model",
            "openai_base_url": "https://openai.example/v1",
            "anthropic_base_url": "https://anthropic.example",
            "api_key": "custom-token",
            "amap_api_key": "custom-amap",
        },
    )
    models = client.get("/admin/ai-config/models", headers={"X-Admin-Key": "test-admin-key"})
    tested = client.post("/admin/ai-config/test", headers={"X-Admin-Key": "test-admin-key"})

    assert updated.status_code == 200
    assert updated.json()["protocol"] == "anthropic"
    assert updated.json()["selected_model"] == "other-model"
    assert updated.json()["anthropic_base_url"] == "https://anthropic.example"
    assert updated.json()["api_key"] == "custom-token"
    assert updated.json()["amap_api_key"] == "custom-amap"
    assert models.json()["models"] == ["mimo-v2.5-pro", "other-model"]
    assert tested.json()["ok"] is True
    assert tested.json()["sample_category"] == "food"
    assert tested.json()["amap_category"] == "food"
    assert tested.json()["llm_status"] == "failed"
    assert tested.json()["sample_keyword"] == "江西小炒(西溪北苑东区店)"
    assert tested.json()["amap_name"] == "江西小炒(西溪北苑东区店)"
    assert tested.json()["expected_category"] == "food"
    assert tested.json()["category_matched"] is True
    assert tested.json()["per_capita"] == 58
    assert tested.json()["tags"] == ["江西菜", "小炒"]
    reloaded = client.get("/admin/ai-config", headers={"X-Admin-Key": "test-admin-key"})
    assert reloaded.json()["saved_models"] == ["mimo-v2.5-pro", "other-model"]


def test_admin_ai_connection_test_rejects_missing_amap_evidence(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    settings.llm_api_key = "secret-token-1234"
    settings.llm_model = "mimo-v2.5-pro"

    def missing_amap(db: Session, keyword="江西小炒(西溪北苑东区店)", city=None, expected_category="food") -> dict:
        raise RuntimeError("AMap MCP returned no POI candidate")

    monkeypatch.setattr("app.api.routes.admin.test_category_completion", missing_amap)

    tested = client.post("/admin/ai-config/test", headers={"X-Admin-Key": "test-admin-key"})

    assert tested.status_code == 502
    assert "AMap MCP returned no POI candidate" in tested.json()["detail"]


def test_admin_ai_model_list_persists_first_model_when_none_selected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_api_key", "secret-token-1234")
    monkeypatch.setattr(settings, "llm_model", "")
    monkeypatch.setattr("app.api.routes.admin.list_models", lambda db, protocol: ["first-model", "second-model"])

    models = client.get("/admin/ai-config/models", headers={"X-Admin-Key": "test-admin-key"})
    config = client.get("/admin/ai-config", headers={"X-Admin-Key": "test-admin-key"})

    assert models.status_code == 200
    assert models.json()["models"] == ["first-model", "second-model"]
    assert config.json()["saved_models"] == ["first-model", "second-model"]
    assert config.json()["selected_model"] == "first-model"


def test_admin_ai_connection_test_accepts_custom_keyword(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_test(db: Session, keyword: str, city: str | None = None, expected_category: str | None = None) -> dict:
        captured.update({"keyword": keyword, "city": city, "expected_category": expected_category})
        return {
            "category": "play",
            "sample_keyword": keyword,
            "sample_city": city,
            "expected_category": expected_category,
            "category_matched": True,
            "amap_name": "浩波台球俱乐部(汇银中心店)",
            "amap_address": "汇银中心",
            "amap_poi_type": "体育休闲服务;运动场馆;台球厅",
            "amap_poi_typecode": "080304",
            "amap_poi_id": "B002",
            "amap_city": "杭州市",
            "amap_adname": "余杭区",
            "amap_tel": "",
            "amap_business_area": "未来科技城",
            "rating": 4.7,
            "per_capita": 69,
            "tags": ["台球", "桌球"],
            "signature_dishes": "台球, 桌球",
            "photos_count": 1,
            "first_photo_url": None,
            "amap_category": "play",
            "amap_category_reason": "AMap POI type/name indicates leisure or activity service: 080304",
            "llm_category": "play",
            "llm_status": "ok",
            "llm_message": "LLM returned play",
            "evidence_note": "AMap evidence",
        }

    monkeypatch.setattr("app.api.routes.admin.test_category_completion", fake_test)

    tested = client.post(
        "/admin/ai-config/test",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"keyword": "浩波台球俱乐部(汇银中心店)", "city": "杭州"},
    )

    assert tested.status_code == 200
    assert captured == {"keyword": "浩波台球俱乐部(汇银中心店)", "city": "杭州", "expected_category": None}
    assert tested.json()["sample_category"] == "play"
    assert tested.json()["expected_category"] is None
    assert tested.json()["amap_poi_typecode"] == "080304"


def test_admin_ai_completion_classifies_default_food_play_and_stay_samples(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import ai_config

    pois = {
        "江西小炒(西溪北苑东区店)": {
            "amap_poi_id": "B001",
            "name": "江西小炒(西溪北苑东区店)",
            "address": "西溪北苑东区",
            "city": "杭州市",
            "poi_type": "餐饮服务;中餐厅",
            "poi_typecode": "050100",
            "rating": 4.6,
            "per_capita": 58,
            "tags": ["江西菜", "小炒"],
            "signature_dishes": "江西菜, 小炒",
            "photos_count": 2,
        },
        "浩波台球俱乐部(汇银中心店)": {
            "amap_poi_id": "B002",
            "name": "浩波台球俱乐部(汇银中心店)",
            "address": "汇银中心",
            "city": "杭州市",
            "poi_type": "体育休闲服务;运动场馆;台球厅",
            "poi_typecode": "080304",
        },
        "海友酒店(杭州阿里巴巴全球总部店)": {
            "amap_poi_id": "B003",
            "name": "海友酒店(杭州阿里巴巴全球总部店)",
            "address": "阿里巴巴全球总部附近",
            "city": "杭州市",
            "poi_type": "住宿服务;宾馆酒店",
            "poi_typecode": "100100",
        },
    }

    def fake_search(keyword: str, city=None, amap_key=None) -> list[dict]:
        return [pois[keyword]]

    monkeypatch.setattr(ai_config.amap_mcp, "search_restaurants", fake_search)
    monkeypatch.setattr(ai_config, "complete_todo_category", lambda db, title, note=None: "play")

    food = ai_config.test_category_completion(db_session, "江西小炒(西溪北苑东区店)", city="杭州", expected_category="food")
    play = ai_config.test_category_completion(db_session, "浩波台球俱乐部(汇银中心店)", city="杭州", expected_category="play")
    stay = ai_config.test_category_completion(db_session, "海友酒店(杭州阿里巴巴全球总部店)", city="杭州", expected_category="stay")

    assert food["category"] == "food"
    assert food["per_capita"] == 58
    assert food["tags"] == ["江西菜", "小炒"]
    assert play["category"] == "play"
    assert stay["category"] == "stay"


def test_amap_mcp_normalizes_richer_poi_fields() -> None:
    from app import amap_mcp

    pois = amap_mcp._pois_from_payload(
        {
            "pois": [
                {
                    "id": "B001",
                    "name": "江西小炒(西溪北苑东区店)",
                    "address": "西溪北苑东区",
                    "cityname": "杭州市",
                    "adname": "余杭区",
                    "pname": "浙江省",
                    "type": "餐饮服务;中餐厅",
                    "typecode": "050100",
                    "tel": "0571-00000000",
                    "businessarea": "西溪",
                    "biz_ext": {"rating": "4.6", "cost": "58"},
                    "tag": "江西菜;小炒",
                    "photos": [{"url": "https://example.com/a.jpg"}],
                }
            ]
        }
    )

    assert pois[0]["poi_typecode"] == "050100"
    assert pois[0]["adname"] == "余杭区"
    assert pois[0]["rating"] == 4.6
    assert pois[0]["per_capita"] == 58
    assert pois[0]["tags"] == ["江西菜", "小炒"]
    assert pois[0]["photos_count"] == 1
    assert pois[0]["first_photo_url"] == "https://example.com/a.jpg"


def test_llm_category_completion_uses_openai_chat_response(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai_config import complete_todo_category

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_api_key", "secret-token-1234")
    monkeypatch.setattr(settings, "llm_model", "mimo-v2.5-pro")
    monkeypatch.setattr(settings, "llm_openai_base_url", "https://openai.example/v1")

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "food"}}]}

    def fake_post(url: str, headers: dict, json: dict, timeout: int) -> FakeResponse:
        assert url == "https://openai.example/v1/chat/completions"
        assert headers["Authorization"] == "Bearer secret-token-1234"
        assert json["model"] == "mimo-v2.5-pro"
        assert "Title: hotpot dinner" in json["messages"][0]["content"]
        assert json["max_tokens"] == 64
        assert timeout == 20
        return FakeResponse()

    monkeypatch.setattr("app.ai_config.httpx.post", fake_post)

    assert complete_todo_category(db_session, "hotpot dinner", "weekend meal together") == "food"


def test_llm_category_completion_reports_openai_empty_response(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai_config import complete_todo_category

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_api_key", "secret-token-1234")
    monkeypatch.setattr(settings, "llm_model", "mimo-v2.5-pro")

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"finish_reason": "length", "message": {"content": ""}}]}

    monkeypatch.setattr("app.ai_config.httpx.post", lambda *args, **kwargs: FakeResponse())

    with pytest.raises(RuntimeError, match="finish_reason='length'"):
        complete_todo_category(db_session, "hotpot dinner")


def test_llm_category_completion_retries_openai_length_empty_response(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.ai_config import complete_todo_category

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_api_key", "secret-token-1234")
    monkeypatch.setattr(settings, "llm_model", "mimo-v2.5-pro")
    calls: list[int] = []

    class FakeResponse:
        def __init__(self, payload: dict) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    def fake_post(*args, **kwargs) -> FakeResponse:
        calls.append(kwargs["json"]["max_tokens"])
        if len(calls) == 1:
            return FakeResponse({"choices": [{"finish_reason": "length", "message": {"content": ""}}]})
        return FakeResponse({"choices": [{"finish_reason": "stop", "message": {"content": "food"}}]})

    monkeypatch.setattr("app.ai_config.httpx.post", fake_post)

    assert complete_todo_category(db_session, "hotpot dinner") == "food"
    assert calls == [64, 256]


def test_admin_ai_completion_uses_amap_restaurant_evidence(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import ai_config

    captured: dict[str, str | None] = {}

    def fake_search(keyword: str, city=None, amap_key=None) -> list[dict]:
        assert keyword == "江西小炒(西溪北苑东区店)"
        return [
            {
                "amap_poi_id": "B001",
                "name": "江西小炒(西溪北苑东区店)",
                "address": "杭州市西溪北苑东区",
                "city": "杭州市",
                "poi_type": "050000",
            }
        ]

    def fake_complete(db: Session, title: str, note: str | None = None) -> str:
        captured["title"] = title
        captured["note"] = note
        return "food"

    monkeypatch.setattr(ai_config.amap_mcp, "search_restaurants", fake_search)
    monkeypatch.setattr(ai_config, "complete_todo_category", fake_complete)

    result = ai_config.test_category_completion(db_session)

    assert result["category"] == "food"
    assert result["sample_keyword"] == "江西小炒(西溪北苑东区店)"
    assert result["amap_name"] == "江西小炒(西溪北苑东区店)"
    assert captured["title"] == "江西小炒(西溪北苑东区店)"
    assert "AMap MCP returned a real POI" in str(captured["note"])
    assert "杭州市西溪北苑东区" in str(captured["note"])


def test_admin_ai_completion_keeps_amap_success_when_llm_has_empty_content(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import ai_config

    monkeypatch.setattr(
        ai_config.amap_mcp,
        "search_restaurants",
        lambda keyword, city=None, amap_key=None: [
            {
                "amap_poi_id": "B001",
                "name": "江西小炒(西溪北苑东区店)",
                "address": "杭州市西溪北苑东区",
                "city": "杭州市",
                "poi_type": "050000",
            }
        ],
    )

    def empty_llm(db: Session, title: str, note: str | None = None) -> str:
        raise RuntimeError("LLM returned empty category text; finish_reason='length'")

    monkeypatch.setattr(ai_config, "complete_todo_category", empty_llm)

    result = ai_config.test_category_completion(db_session)

    assert result["category"] == "food"
    assert result["amap_category"] == "food"
    assert result["llm_category"] is None
    assert result["llm_status"] == "failed"
    assert "empty category text" in str(result["llm_message"])
