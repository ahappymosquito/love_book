"""API regression tests for auth, legacy received gifts, wrapped-gift routing, retired receipts, reminders, private media cleanup, timeline, todo, cycle predictions, AI gating, and fallbacks."""

import asyncio
from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy import select, text
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

import app.api.image_uploads as image_uploads
import app.api.routes.admin as admin_routes
import app.api.routes.love_receipts as love_receipt_routes
import app.api.routes.quotes as quote_routes
import app.core.database as database
import app.cycles as cycles
import app.habits as habits
import app.main as main_app
import app.services as services
from app.core.config import get_settings
from app.version import APP_VERSION
from app.models import CycleDailyLog, CyclePhase, DefaultQuote, DeviceToken, Event, EventKind, HabitReminderRun, HabitTask, Image as DBImage, LoveReceipt, LoveReceiptImage, LoveReceiptImageKind, LoveReceiptMood, LoveReceiptStatus, LoveReceiptType, MeetingSession
from app.storage import media_path, write_media_file
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


def test_health_exposes_version_and_source_revision(client: TestClient) -> None:
    health = client.get("/health")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "version": APP_VERSION, "git_sha": "development"}


def test_legacy_received_gift_stays_readable_editable_and_pair_private(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    created = client.post(
        "/events",
        headers=auth(token_a),
        json={
            "title": "下班后收到的一束花",
            "description": "被惦记到了",
            "event_kind": "gift_received",
            "gift_rating": 5,
            "gift_feelings": ["happy", "pressured"],
        },
    )
    assert created.status_code == 201
    event = created.json()
    assert event["event_kind"] == "gift_received"
    assert event["gift_rating"] == 5
    assert event["gift_feelings"] == ["happy", "pressured"]
    assert event["gift_state"] == "opened"
    assert event["gift_receiver_id"] == pair_tokens["user_a"]["id"]
    assert event["gift_feedback"] == "被惦记到了"
    assert event["gift_masked"] is False
    assert event["gift_can_open"] is False
    uploaded = client.post(
        f"/events/{event['id']}/images",
        headers=auth(token_a),
        files={"file": ("flower.png", sample_png_bytes(), "image/png")},
    )
    assert uploaded.status_code == 201
    image_id = uploaded.json()["id"]
    assert client.get(f"/images/{image_id}/thumb", headers=auth(token_b)).status_code == 200
    assert client.get(f"/images/{image_id}/file", headers=auth(token_a)).content == sample_png_bytes()

    edited = client.patch(
        f"/events/{event['id']}",
        headers=auth(token_a),
        json={"gift_rating": 4, "gift_feelings": ["touched", "complicated"], "description": "很喜欢"},
    )
    assert edited.status_code == 200
    assert edited.json()["gift_rating"] == 4
    assert edited.json()["gift_feelings"] == ["touched", "complicated"]
    assert edited.json()["gift_feedback"] == "很喜欢"
    assert client.patch(
        f"/events/{event['id']}",
        headers=auth(token_b),
        json={"gift_rating": 3},
    ).status_code == 403

    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    other_headers = auth(other_pair["user_a_token"])
    assert client.get(f"/events/{event['id']}", headers=other_headers).status_code == 404
    assert client.get(f"/images/{image_id}/thumb", headers=other_headers).status_code == 404


def test_legacy_gift_create_endpoint_is_removed(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    headers = auth(str(pair_tokens["user_a_token"]))
    assert client.post("/events/gifts", headers=headers, data={"title": "一盒糖"}).status_code in {404, 405}
    assert client.post("/events", headers=headers, json={"title": "一盒糖", "event_kind": "gift"}).status_code == 422


def test_received_gift_keeps_kind_inside_meeting_and_legacy_writes_are_gone(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    headers = auth(str(pair_tokens["user_a_token"]))
    client.post(
        "/meeting-sessions",
        headers=headers,
        json={"title": "周末见面", "started_on": "2026-07-20", "ended_on": "2026-07-22"},
    )
    created = client.post(
        "/events",
        headers=headers,
        json={"title": "见面时收到的花", "event_kind": "gift_received", "occurred_at": "2026-07-21T12:00:00Z"},
    )
    assert created.status_code == 201
    event = created.json()
    assert event["event_kind"] == "gift_received"
    assert event["meeting_session_id"] is not None
    assert event["meeting_session"]["title"] == "周末见面"
    wrapped = client.post(
        "/events/gifts/wrap",
        headers=headers,
        data={"title": "见面时送的花", "occurred_at": "2026-07-21T13:00:00Z"},
    )
    assert wrapped.status_code == 201
    assert wrapped.json()["event_kind"] == "gift"
    assert wrapped.json()["meeting_session_id"] == event["meeting_session_id"]
    retired = client.post(
        "/love-receipts",
        headers=headers,
        data={"receipt_type": "gift", "title": "旧流程"},
    )
    assert retired.status_code == 410


def test_love_receipt_table_uses_mysql_compatible_text_columns() -> None:
    ddl = str(CreateTable(LoveReceipt.__table__).compile(dialect=mysql.dialect()))

    assert "message TEXT NOT NULL" in ddl
    assert "message TEXT NOT NULL DEFAULT" not in ddl
    query_sql = str(
        love_receipt_routes._love_receipt_list_query([LoveReceipt.pair_id == 1]).compile(dialect=mysql.dialect())
    )
    assert "NULLS LAST" not in query_sql
    assert "love_receipts.completed_at IS NULL" in query_sql


def test_legacy_love_receipt_migration_is_idempotent_and_copies_media(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
) -> None:
    pair_id = int(pair_tokens["pair_id"])
    sender_id = int(pair_tokens["user_a"]["id"])
    receiver_id = int(pair_tokens["user_b"]["id"])
    receipt = LoveReceipt(
        pair_id=pair_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        receipt_type=LoveReceiptType.gift,
        title="旧回执里的一束花",
        message="路上看到就想送给你",
        receipt_content="收到时很惊喜",
        receipt_mood=LoveReceiptMood.happy,
        receipt_rating=5,
        status=LoveReceiptStatus.completed,
    )
    db_session.add(receipt)
    db_session.flush()
    original_key = f"love-receipts/cover/originals/{pair_id}/{receipt.id}/legacy.png"
    thumb_key = f"love-receipts/cover/thumbs/{pair_id}/{receipt.id}/legacy.jpg"
    write_media_file(original_key, sample_png_bytes())
    write_media_file(thumb_key, sample_png_bytes())
    legacy_image = LoveReceiptImage(
        love_receipt_id=receipt.id,
        author_id=sender_id,
        kind=LoveReceiptImageKind.cover,
        sort_order=0,
        storage_key=original_key,
        thumb_storage_key=thumb_key,
        storage_backend="local",
        mime_type="image/png",
        size_bytes=len(sample_png_bytes()),
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=len(sample_png_bytes()),
    )
    db_session.add(legacy_image)
    db_session.commit()

    database._migrate_love_receipts_to_events(db_session)
    db_session.commit()
    db_session.refresh(receipt)
    migrated = db_session.get(Event, receipt.timeline_event_id)
    assert migrated is not None
    assert migrated.creator_id == receiver_id
    assert migrated.event_kind == EventKind.gift_received
    assert migrated.gift_rating == 5
    assert migrated.gift_feelings == ["happy"]
    assert "收到时很惊喜" in (migrated.description or "")
    assert "当时的感受" not in (migrated.description or "")
    copied_images = db_session.execute(
        select(DBImage).where(DBImage.legacy_love_receipt_image_id == legacy_image.id)
    ).scalars().all()
    assert len(copied_images) == 1
    assert copied_images[0].sort_order == 0
    assert f"legacy-love-receipt-{legacy_image.id}" in copied_images[0].storage_key
    assert media_path(copied_images[0].storage_key).is_file()

    database._migrate_love_receipts_to_events(db_session)
    db_session.commit()
    assert db_session.scalar(select(text("count(*)")).select_from(Event).where(Event.id == migrated.id)) == 1
    assert db_session.scalar(
        select(text("count(*)")).select_from(DBImage).where(DBImage.legacy_love_receipt_image_id == legacy_image.id)
    ) == 1


def test_todo_category_enum_migration_sql_targets_mysql_only() -> None:
    expected = ["ALTER TABLE todo_items MODIFY category ENUM('food','play','stay','prep','wish') NOT NULL"]

    assert database._todo_category_enum_migration_sql("mysql") == expected
    assert database._todo_category_enum_migration_sql("mariadb") == expected
    assert database._todo_category_enum_migration_sql("sqlite") == []


def test_love_receipt_mood_enum_migration_and_rating_column_are_registered() -> None:
    expected = [
        "ALTER TABLE love_receipts MODIFY receipt_mood ENUM('happy','surprised','touched','reassured','cherished','hug','disappointed','wronged','pressured','not_my_style','upset','complicated') NULL"
    ]

    assert database._love_receipt_mood_enum_migration_sql("mysql") == expected
    assert database._love_receipt_mood_enum_migration_sql("mariadb") == expected
    assert database._love_receipt_mood_enum_migration_sql("sqlite") == []
    assert (
        "love_receipts",
        "receipt_rating",
        {"default": "INTEGER NULL", "mysql": "TINYINT NULL", "mariadb": "TINYINT NULL"},
    ) in database._LIGHTWEIGHT_COLUMNS


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
    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: sent.append(kwargs) or True)

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


def test_habit_reminder_scan_skips_dissolved_pairs(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = str(pair_tokens["user_a_token"])
    client.patch("/auth/me", headers=auth(token), json={"email": "a@example.com"})
    client.post("/habits/tasks", headers=auth(token), json={"title": "拉伸", "color": "peach"})
    sent: list[dict[str, object]] = []
    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: sent.append(kwargs) or True)
    assert client.post("/auth/me/dissolve", headers=auth(token), json={"message": "先放下"}).status_code == 204
    db_session.expire_all()
    count = habits.scan_habit_reminders(db_session, date(2026, 6, 10))
    assert count == 0
    assert sent == []


def test_habit_reminder_scan_retries_after_failed_delivery(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = str(pair_tokens["user_a_token"])
    client.patch("/auth/me", headers=auth(token), json={"email": "a@example.com"})
    client.post("/habits/tasks", headers=auth(token), json={"title": "拉伸", "color": "peach"})
    target_date = date(2026, 6, 10)

    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: False)
    failed_count = habits.scan_habit_reminders(db_session, target_date)

    assert failed_count == 0
    assert db_session.query(HabitReminderRun).filter_by(date=target_date).count() == 0

    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: True)
    retried_count = habits.scan_habit_reminders(db_session, target_date)

    assert retried_count == 1
    assert db_session.query(HabitReminderRun).filter_by(date=target_date).count() == 1


def test_habit_reminder_loop_continues_after_scan_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    scan_calls = 0

    class DummySession:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, *args: object) -> None:
            return None

    async def no_wait(_: float) -> None:
        return None

    def flaky_scan(*args: object) -> int:
        nonlocal scan_calls
        scan_calls += 1
        if scan_calls == 1:
            raise RuntimeError("temporary database failure")
        raise asyncio.CancelledError

    monkeypatch.setattr(main_app, "SessionLocal", DummySession)
    monkeypatch.setattr(main_app.asyncio, "sleep", no_wait)
    monkeypatch.setattr(main_app, "scan_habit_reminders", flaky_scan)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main_app.habit_reminder_loop())

    assert scan_calls == 2


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


def test_event_datetimes_with_offset_are_stored_as_the_same_instant(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    headers = auth(str(pair_tokens["user_a_token"]))
    created = client.post("/events", headers=headers, json={"title": "北京时间", "occurred_at": "2026-11-14T16:00:00+08:00"})
    assert created.status_code == 201
    event_id = created.json()["id"]

    patched = client.patch(f"/events/{event_id}", headers=headers, json={"occurred_at": "2026-11-15T09:30:00+08:00"})
    assert patched.status_code == 200
    assert patched.json()["occurred_at"] == "2026-11-15T01:30:00Z"

    gift = client.post(
        "/events/gifts/wrap",
        headers=headers,
        data={"title": "花", "occurred_at": "2026-11-14T20:00:00+08:00", "open_at": "2026-11-20T08:00:00+08:00"},
    )
    assert gift.status_code == 201
    assert gift.json()["occurred_at"] == "2026-11-14T12:00:00Z"

    listed = {item["id"]: item for item in client.get("/events", headers=headers).json()}
    assert listed[event_id]["occurred_at"] == "2026-11-15T01:30:00Z"
    assert listed[gift.json()["id"]]["occurred_at"] == "2026-11-14T12:00:00Z"


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
    assert updated.json()["event_kind"] == "offline_meeting"
    assert updated.json()["meeting_session_id"] == meeting_event["meeting_session_id"]


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


def test_range_authority_and_deleting_meeting_reclassifies_event(
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
    assert unmarked.json()["event_kind"] == "offline_meeting"
    deleted = client.delete(f"/meeting-sessions/{first_meeting_id}", headers=auth(token))
    assert deleted.status_code == 204
    assert db_session.get(MeetingSession, first_meeting_id) is None
    detail = client.get(f"/events/{first['id']}", headers=auth(token)).json()
    assert detail["event_kind"] == "memory"
    assert detail["meeting_session_id"] is None


def test_removed_batch_assign_endpoint_returns_not_found(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    target_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "周末约会", "event_kind": "offline_meeting", "visibility_mode": "public"},
    ).json()
    ordinary_event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "吃了晚饭", "visibility_mode": "public"},
    ).json()
    assigned = client.post(
        f"/meeting-sessions/{target_event['meeting_session_id']}/events",
        headers=auth(token_b),
        json={"event_ids": [ordinary_event["id"]]},
    )
    assert assigned.status_code == 404


def test_named_meeting_session_groups_multiple_offline_events(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    session = client.post(
        "/meeting-sessions",
        headers=auth(token_a),
        json={"title": "端午杭州三天", "started_on": "2026-06-20", "ended_on": "2026-06-22"},
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


def test_overlapping_meeting_ranges_merge_and_keep_earlier_title(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])
    morning = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "上午短见面", "started_on": "2026-06-20", "ended_on": "2026-06-20"},
    ).json()
    evening = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "晚上约会", "started_on": "2026-06-20", "ended_on": "2026-06-21"},
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
    assert morning["id"] == evening["id"]
    assert len(listed) == 1
    assert listed[0]["title"] == "上午短见面"
    assert listed[0]["started_on"] == "2026-06-20"
    assert listed[0]["ended_on"] == "2026-06-21"
    assert listed[0]["event_count"] == 2


def test_meeting_session_range_expansion_and_shrink_reclassify_events(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    session = client.post(
        "/meeting-sessions",
        headers=auth(token),
        json={"title": "三天小假期", "started_on": "2026-10-01", "ended_on": "2026-10-03"},
    ).json()
    patched = client.patch(
        f"/meeting-sessions/{session['id']}",
        headers=auth(token),
        json={"title": "三天小假期", "started_on": "2026-10-01", "ended_on": "2026-10-03"},
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

    shrunk = client.patch(
        f"/meeting-sessions/{session['id']}", headers=auth(token),
        json={"started_on": "2026-10-02", "ended_on": "2026-10-03"},
    )
    listed = client.get("/meeting-sessions", headers=auth(token)).json()
    row = db_session.get(MeetingSession, session["id"])
    assert patched.status_code == 200
    assert row is not None
    assert row.started_on == date(2026, 10, 2)
    assert row.ended_on == date(2026, 10, 3)
    assert len(listed) == 1
    assert shrunk.status_code == 200
    assert listed[0]["event_count"] == 2
    assert listed[0]["ended_at"] == "2026-10-03T12:00:00Z"
    events = client.get("/events", headers=auth(token)).json()
    by_time = {item["occurred_at"]: item for item in events}
    assert by_time["2026-10-01T12:00:00Z"]["event_kind"] == "memory"


def test_meeting_sessions_are_pair_private_and_memory_events_auto_become_meetings(
    client: TestClient, pair_tokens: dict[str, str | int]
) -> None:
    token = str(pair_tokens["user_a_token"])
    today = datetime.now(services.CHINA_TZ).date().isoformat()
    session = client.post("/meeting-sessions", headers=auth(token), json={"title": "只属于第一对", "started_on": today, "ended_on": today}).json()
    other_pair = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    hidden = client.get("/meeting-sessions", headers=auth(other_pair["user_a_token"]))
    other_session = client.post(
        "/meeting-sessions",
        headers=auth(other_pair["user_a_token"]),
        json={"title": "另一对的见面", "started_on": today, "ended_on": today},
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
    today = datetime.now(services.CHINA_TZ).date().isoformat()
    session = client.post("/meeting-sessions", headers=auth(token_b), json={"title": "周末见面", "started_on": today, "ended_on": today}).json()

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


def test_mutual_submit_unlocks_after_each_side_submits_comment_or_image(
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
    assert "voices" not in before

    upload = client.post(
        f"/events/{event['id']}/images",
        headers=auth(token_b),
        files={"file": ("photo.png", sample_png_bytes(), "image/png")},
    )
    assert upload.status_code == 201
    image_id = upload.json()["id"]
    stored_image = db_session.get(DBImage, image_id)
    assert stored_image is not None

    after_a = client.get(f"/events/{event['id']}/contents", headers=auth(token_a)).json()
    after_b = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()
    assert after_a["submission_state"]["unlocked"] is True
    assert after_b["submission_state"]["unlocked"] is True
    assert [item["text"] for item in after_a["comments"]] == ["a-comment"]
    assert after_a["images"][0]["id"] == image_id


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


def test_legacy_voice_rows_do_not_count_toward_mutual_submit(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    event = client.post(
        "/events",
        headers=auth(token_a),
        json={"title": "Retired voice", "visibility_mode": "mutual_submit"},
    ).json()
    db_session.execute(
        text(
            "CREATE TABLE voices ("
            "id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, author_id INTEGER NOT NULL, data BLOB NULL, "
            "FOREIGN KEY(event_id) REFERENCES events(id))"
        )
    )
    db_session.execute(
        text("INSERT INTO voices (id, event_id, author_id, data) VALUES (1, :event_id, :author_id, :data)"),
        {"event_id": event["id"], "author_id": int(pair_tokens["user_b"]["id"]), "data": b"legacy"},
    )
    db_session.commit()
    client.post(f"/events/{event['id']}/comments", headers=auth(token_a), json={"text": "only active content"})

    contents = client.get(f"/events/{event['id']}/contents", headers=auth(token_b)).json()

    assert contents["submission_state"] == {
        "current_user_submitted": False,
        "counterpart_submitted": True,
        "unlocked": False,
    }
    assert "voices" not in contents


def test_deleting_event_removes_only_matching_legacy_voice_rows(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session
) -> None:
    token = str(pair_tokens["user_a_token"])
    first = client.post(
        "/events", headers=auth(token), json={"title": "First", "visibility_mode": "public"}
    ).json()
    second = client.post(
        "/events", headers=auth(token), json={"title": "Second", "visibility_mode": "public"}
    ).json()
    db_session.execute(
        text(
            "CREATE TABLE voices ("
            "id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, author_id INTEGER NOT NULL, "
            "FOREIGN KEY(event_id) REFERENCES events(id))"
        )
    )
    db_session.execute(
        text("INSERT INTO voices (id, event_id, author_id) VALUES (1, :first_id, :author_id), (2, :second_id, :author_id)"),
        {
            "first_id": first["id"],
            "second_id": second["id"],
            "author_id": int(pair_tokens["user_a"]["id"]),
        },
    )
    db_session.commit()

    response = client.delete(f"/events/{first['id']}", headers=auth(token))
    remaining = db_session.execute(text("SELECT event_id FROM voices ORDER BY id")).scalars().all()

    assert response.status_code == 204
    assert remaining == [second["id"]]


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


def test_voice_routes_are_removed(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    event = client.post(
        "/events",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"title": "No voice", "visibility_mode": "public"},
    ).json()
    upload = client.post(
        f"/events/{event['id']}/voices",
        headers=auth(str(pair_tokens["user_a_token"])),
        files={"file": ("note.webm", b"voice", "audio/webm")},
    )
    download = client.get(
        "/voices/1/file",
        headers=auth(str(pair_tokens["user_a_token"])),
    )
    assert upload.status_code == 404
    assert download.status_code == 404


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
    assert legacy_image.thumb_data is None
    assert legacy_image.thumb_storage_key.startswith(f"images/thumbs/{pair_tokens['pair_id']}/{event['id']}/")
    assert media_path(legacy_image.thumb_storage_key).read_bytes() == response.content
    assert legacy_image.thumb_size_bytes == len(response.content)
    assert client.get(f"/images/{legacy_image.id}/thumb", headers=auth(token)).content == response.content

    full = client.get(f"/images/{legacy_image.id}/file", headers=auth(token))
    assert full.status_code == 200
    assert full.headers["cache-control"] == "private, max-age=604800"
    assert full.content == original


def test_legacy_image_thumbnail_is_served_without_caching_when_disk_write_fails(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = str(pair_tokens["user_a_token"])
    event = client.post("/events", headers=auth(token), json={"title": "Old photo", "visibility_mode": "public"}).json()
    legacy_image = DBImage(
        event_id=event["id"],
        author_id=int(pair_tokens["user_a"]["id"]),
        file_path="",
        data=sample_png_bytes(),
        thumb_data=None,
        thumb_mime_type="image/jpeg",
        thumb_size_bytes=0,
        mime_type="image/png",
        size_bytes=100,
    )
    db_session.add(legacy_image)
    db_session.commit()

    def broken_write(*args: object, **kwargs: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("app.api.routes.contents.write_media_file", broken_write)
    response = client.get(f"/images/{legacy_image.id}/thumb", headers=auth(token))

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content
    db_session.refresh(legacy_image)
    assert legacy_image.thumb_storage_key is None
    assert legacy_image.thumb_data is None


def test_event_image_upload_removes_written_files_when_commit_fails(
    client: TestClient, pair_tokens: dict[str, str | int], db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = str(pair_tokens["user_a_token"])
    event = client.post("/events", headers=auth(token), json={"title": "Upload", "visibility_mode": "public"}).json()
    written: list[str] = []
    original_write = image_uploads.write_media_file

    def tracking_write(key: str, data: bytes, settings: object = None):
        written.append(key)
        return original_write(key, data)

    monkeypatch.setattr("app.api.image_uploads.write_media_file", tracking_write)
    original_commit = db_session.commit
    calls = {"count": 0}

    def failing_commit() -> None:
        calls["count"] += 1
        if calls["count"] == 1:
            raise RuntimeError("database went away")
        original_commit()

    monkeypatch.setattr(db_session, "commit", failing_commit)
    with pytest.raises(RuntimeError, match="database went away"):
        client.post(
            f"/events/{event['id']}/images",
            headers=auth(token),
            files={"file": ("photo.png", sample_png_bytes(), "image/png")},
        )
    monkeypatch.setattr(db_session, "commit", original_commit)

    assert len(written) == 2
    assert not any(media_path(key).exists() for key in written)
    assert db_session.query(DBImage).filter_by(event_id=event["id"]).count() == 0


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


def put_period(client: TestClient, token: str, start: str, days: int = 2) -> None:
    first = date.fromisoformat(start)
    for offset in range(days):
        response = client.put(
            f"/cycles/logs/{(first + timedelta(days=offset)).isoformat()}",
            headers=auth(token),
            json={"phase": "menstrual", "is_period": True, "flow": "medium"},
        )
        assert response.status_code == 200


def test_cycle_demo_and_clear_all_endpoints_are_removed(client: TestClient, pair_tokens: dict[str, str | int]) -> None:
    token = str(pair_tokens["user_a_token"])

    assert client.post("/cycles/example-data", headers=auth(token)).status_code in {404, 405}
    assert client.delete("/cycles/logs", headers=auth(token)).status_code in {404, 405}


def test_cycle_dashboard_without_period_records_has_no_prediction(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])
    client.put("/cycles/logs/2026-05-10", headers=auth(token), json={"is_period": False, "flow": "none", "mood": "calm"})

    dashboard = client.get("/cycles/dashboard?start=2026-05-10&end=2026-06-30", headers=auth(token)).json()

    stats = dashboard["stats"]
    assert dashboard["is_empty"] is False
    assert stats["has_prediction"] is False
    assert stats["current_cycle_day"] is None
    assert stats["current_phase"] == "unknown"
    for field in ("last_period_start", "next_period_start", "next_period_end", "ovulation_date", "fertile_start", "fertile_end", "prediction_start", "prediction_end"):
        assert stats[field] is None
    logs = {log["date"]: log for log in dashboard["logs"]}
    assert logs["2026-05-10"]["source"] == "recorded"
    assert logs["2026-05-10"]["phase"] == "unknown"
    assert all(log["source"] in {"recorded", "empty"} for log in dashboard["logs"])
    assert not any(log["is_period"] for log in dashboard["logs"])


def test_cycle_short_or_long_period_segments_do_not_anchor_cycles(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 4, 10))
    token = str(pair_tokens["user_a_token"])
    put_period(client, token, "2026-01-01", days=1)
    put_period(client, token, "2026-02-01", days=12)
    put_period(client, token, "2026-03-01", days=3)
    put_period(client, token, "2026-03-29", days=3)

    dashboard = client.get("/cycles/dashboard?start=2026-01-01&end=2026-02-12", headers=auth(token)).json()

    stats = dashboard["stats"]
    assert stats["has_prediction"] is True
    assert stats["average_cycle_length"] == 28
    assert stats["last_period_start"] == "2026-03-29"
    assert stats["next_period_start"] == "2026-04-26"
    logs = {log["date"]: log for log in dashboard["logs"]}
    assert logs["2026-01-01"]["source"] == "recorded"
    assert logs["2026-01-01"]["is_period"] is True
    assert logs["2026-02-12"]["source"] == "recorded"
    assert logs["2026-02-12"]["phase"] == "menstrual"


def test_cycle_single_day_logged_today_still_anchors_prediction(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])
    put_period(client, token, "2026-05-22", days=1)

    stats = client.get("/cycles/dashboard?start=2026-05-22&end=2026-05-22", headers=auth(token)).json()["stats"]

    assert stats["has_prediction"] is True
    assert stats["last_period_start"] == "2026-05-22"
    assert stats["next_period_start"] == "2026-06-19"


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


def test_cycle_dashboard_without_records_keeps_every_day_empty(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    response = client.get(
        "/cycles/dashboard?start=2026-05-20&end=2026-05-23",
        headers=auth(str(pair_tokens["user_a_token"])),
    )

    assert response.status_code == 200
    assert response.json()["stats"]["next_period_start"] is None
    logs = response.json()["logs"]
    assert [(log["date"], log["source"], log["phase"], log["is_period"]) for log in logs] == [
        ("2026-05-20", "empty", "unknown", False),
        ("2026-05-21", "empty", "unknown", False),
        ("2026-05-22", "empty", "unknown", False),
        ("2026-05-23", "empty", "unknown", False),
    ]


def test_cycle_dashboard_predicts_past_non_period_and_future_unrecorded_days(
    client: TestClient, pair_tokens: dict[str, str | int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 5, 22))
    token = str(pair_tokens["user_a_token"])
    put_period(client, token, "2026-05-18", days=2)

    response = client.get("/cycles/dashboard?start=2026-05-18&end=2026-06-16", headers=auth(token))

    assert response.status_code == 200
    payload = response.json()
    assert payload["stats"]["next_period_start"] == "2026-06-15"
    assert payload["stats"]["next_period_end"] == "2026-06-16"
    logs = {log["date"]: log for log in payload["logs"]}
    assert logs["2026-05-19"]["source"] == "recorded"
    assert logs["2026-05-21"]["source"] == "predicted"
    assert logs["2026-05-21"]["is_period"] is False
    assert logs["2026-05-21"]["phase"] == "follicular"
    assert logs["2026-05-22"]["source"] == "predicted"
    assert logs["2026-05-22"]["is_period"] is False
    assert logs["2026-06-15"]["source"] == "predicted"
    assert logs["2026-06-15"]["is_period"] is True
    assert logs["2026-06-15"]["phase"] == "predicted_period"


def test_cycle_non_period_submission_stores_fact_not_client_phase(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cycles, "local_today", lambda: date(2026, 2, 15))
    token = str(pair_tokens["user_a_token"])
    for start in ["2026-01-01", "2026-01-29"]:
        put_period(client, token, start)

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
    put_period(client, token, "2026-04-21", days=5)
    put_period(client, token, "2026-05-19", days=2)
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
        put_period(client, token, start)
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
        put_period(client, token, start)

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
        put_period(client, token, start)

    dashboard = client.get("/cycles/dashboard?start=2026-07-01&end=2026-08-31", headers=auth(token)).json()

    assert dashboard["stats"]["average_cycle_length"] == 32
    assert dashboard["stats"]["next_period_start"] == "2026-08-07"
