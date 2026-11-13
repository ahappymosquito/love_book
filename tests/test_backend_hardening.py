"""Backend hardening tests: production admin-key guard, per-user reminder dedupe, and the login failure window."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.habits as habits
import app.security_credentials as security_credentials
from app.core.config import get_settings
from app.models import HabitReminderRun
from app.security_credentials import LoginThrottle
from tests.conftest import auth


def test_admin_key_is_refused_in_production_while_default(client: TestClient) -> None:
    settings = get_settings()
    settings.admin_key = "change-me"
    settings.app_env = "production"

    listed = client.get("/admin/pairs", headers={"X-Admin-Key": "change-me"})
    login = client.post("/admin/auth", json={"admin_key": "change-me"})

    assert listed.status_code == 503
    assert login.status_code == 503


def test_default_admin_key_still_works_outside_production(client: TestClient) -> None:
    settings = get_settings()
    settings.admin_key = "change-me"
    settings.app_env = "development"

    assert client.get("/admin/pairs", headers={"X-Admin-Key": "change-me"}).status_code == 200
    assert client.get("/admin/pairs", headers={"X-Admin-Key": "change-me-not"}).status_code == 403
    assert client.post("/admin/auth", json={"admin_key": "wrong"}).status_code == 401


def test_habit_reminder_commits_each_send_before_a_later_failure(
    client: TestClient,
    pair_tokens: dict[str, str | int],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key, email in (("user_a_token", "a@example.com"), ("user_b_token", "b@example.com")):
        token = str(pair_tokens[key])
        client.patch("/auth/me", headers=auth(token), json={"email": email})
        client.post("/habits/tasks", headers=auth(token), json={"title": "拉伸", "color": "peach"})
    sent: list[str] = []

    def deliver(**kwargs: object) -> bool:
        if kwargs["recipient_email"] == "b@example.com":
            raise RuntimeError("smtp exploded")
        sent.append(str(kwargs["recipient_email"]))
        return True

    monkeypatch.setattr("app.habits.notify_habit_reminder", deliver)
    target = date(2026, 6, 10)

    first = habits.scan_habit_reminders(db_session, target)
    monkeypatch.setattr("app.habits.notify_habit_reminder", lambda **kwargs: sent.append(str(kwargs["recipient_email"])) or True)
    second = habits.scan_habit_reminders(db_session, target)

    assert first == 1
    assert second == 1
    assert sent == ["a@example.com", "b@example.com"]
    assert db_session.query(HabitReminderRun).filter_by(date=target).count() == 2


def test_login_throttle_forgets_failures_outside_the_window(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = {"now": 1000.0}
    monkeypatch.setattr(security_credentials.time, "monotonic", lambda: clock["now"])
    throttle = LoginThrottle()

    for _ in range(4):
        throttle.fail("account:a")
    clock["now"] += security_credentials.FAILURE_WINDOW_SECONDS + 1
    throttle.fail("account:a")
    assert throttle.retry_after("account:a") == 0

    for _ in range(4):
        throttle.fail("account:a")
    assert throttle.retry_after("account:a") > 0

    throttle.succeed("account:a")
    assert throttle.retry_after("account:a") == 0
