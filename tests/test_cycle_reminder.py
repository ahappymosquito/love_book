"""Tests for the pair-level cycle mail reminder: settings defaults and validation, the send window, one mail per
predicted period, and skipping dissolved pairs or recipients without email."""

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.cycle_reminders as cycle_reminders
from app.models import CycleReminderRun, Pair
from tests.conftest import auth


def record_period(client: TestClient, token: str, start: date, days: int = 5) -> None:
    for offset in range(days):
        day = start + timedelta(days=offset)
        response = client.put(f"/cycles/logs/{day.isoformat()}", headers=auth(token), json={"is_period": True})
        assert response.status_code == 200, response.text


def capture_mails(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    sent: list[dict] = []

    def fake_notify(**kwargs) -> bool:
        sent.append(kwargs)
        return True

    monkeypatch.setattr(cycle_reminders, "notify_cycle_reminder", fake_notify)
    return sent


def test_reminder_defaults_to_off_for_the_partner_and_validates_recipient(client: TestClient, pair_tokens: dict) -> None:
    token_a = str(pair_tokens["user_a_token"])
    assert client.get("/cycles/reminder").status_code == 401

    default = client.get("/cycles/reminder", headers=auth(token_a)).json()
    assert default["enabled"] is False
    assert default["days_before"] == 3
    assert default["recipient_user_id"] == pair_tokens["user_b"]["id"]
    assert default["next_send_on"] is None

    stranger = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "C", "user_b_display_name": "D"},
    ).json()
    outsider = client.put(
        "/cycles/reminder",
        headers=auth(token_a),
        json={"enabled": True, "days_before": 2, "recipient_user_id": stranger["user_a"]["id"]},
    )
    too_early = client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 30})
    saved = client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 2})
    seen_by_partner = client.get("/cycles/reminder", headers=auth(str(pair_tokens["user_b_token"]))).json()

    assert outsider.status_code == 422
    assert too_early.status_code == 422
    assert saved.status_code == 200
    assert seen_by_partner["enabled"] is True
    assert seen_by_partner["days_before"] == 2
    assert seen_by_partner["recipient_user_id"] == pair_tokens["user_b"]["id"]
    assert seen_by_partner["updated_by_id"] == pair_tokens["user_a"]["id"]


def test_due_period_start_window() -> None:
    start = date(2026, 6, 10)
    assert cycle_reminders.due_period_start(start, 3, date(2026, 6, 6)) is None
    assert cycle_reminders.due_period_start(start, 3, date(2026, 6, 7)) == start
    assert cycle_reminders.due_period_start(start, 3, date(2026, 6, 9)) == start
    assert cycle_reminders.due_period_start(start, 3, date(2026, 6, 10)) is None
    assert cycle_reminders.due_period_start(None, 3, date(2026, 6, 9)) is None


def test_seconds_until_next_cycle_reminder_targets_nine_in_the_morning() -> None:
    tz = datetime.now().astimezone().tzinfo
    assert cycle_reminders.seconds_until_next_cycle_reminder(datetime(2026, 6, 1, 8, 0, tzinfo=tz)) == 3600
    assert cycle_reminders.seconds_until_next_cycle_reminder(datetime(2026, 6, 1, 9, 0, tzinfo=tz)) == 24 * 3600


def test_scan_mails_the_recipient_once_per_predicted_period(
    client: TestClient, pair_tokens: dict, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    today = date(2026, 6, 20)
    # A single 5-day period with the default 28-day cycle predicts the next start on today + 3.
    record_period(client, token_a, today - timedelta(days=25))
    client.patch("/auth/me", headers=auth(token_b), json={"email": "b@example.com"})
    client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 3})
    sent = capture_mails(monkeypatch)

    first = cycle_reminders.scan_cycle_reminders(db_session, today)
    second = cycle_reminders.scan_cycle_reminders(db_session, today + timedelta(days=1))

    assert first == 1
    assert second == 0
    assert len(sent) == 1
    assert sent[0]["recipient_email"] == "b@example.com"
    assert sent[0]["period_start"] == today + timedelta(days=3)
    assert sent[0]["days_left"] == 3
    assert db_session.query(CycleReminderRun).count() == 1


def test_scan_waits_for_the_window_and_skips_missing_email_or_closed_pairs(
    client: TestClient, pair_tokens: dict, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    today = date(2026, 6, 20)
    record_period(client, token_a, today - timedelta(days=25))
    client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 1})
    sent = capture_mails(monkeypatch)

    assert cycle_reminders.scan_cycle_reminders(db_session, today) == 0

    client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 3})
    assert cycle_reminders.scan_cycle_reminders(db_session, today) == 0

    client.patch("/auth/me", headers=auth(str(pair_tokens["user_b_token"])), json={"email": "b@example.com"})
    pair = db_session.get(Pair, pair_tokens["pair_id"])
    pair.dissolved_at = datetime(2026, 6, 19)
    db_session.commit()
    assert cycle_reminders.scan_cycle_reminders(db_session, today) == 0
    assert sent == []


def test_scan_ignores_pairs_without_a_prediction_or_with_reminder_off(
    client: TestClient, pair_tokens: dict, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    client.patch("/auth/me", headers=auth(str(pair_tokens["user_b_token"])), json={"email": "b@example.com"})
    client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": True, "days_before": 3})
    sent = capture_mails(monkeypatch)
    today = date(2026, 6, 20)

    assert cycle_reminders.scan_cycle_reminders(db_session, today) == 0

    record_period(client, token_a, today - timedelta(days=25))
    client.put("/cycles/reminder", headers=auth(token_a), json={"enabled": False, "days_before": 3})
    assert cycle_reminders.scan_cycle_reminders(db_session, today) == 0
    assert sent == []
