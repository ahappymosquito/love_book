"""API regression tests for Argon2id security-password sessions and the public runner leaderboard."""

from datetime import timedelta

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DeviceToken, GameScore, User, utc_now
from app.core import database
from app.security_credentials import normalize_login_name, password_login_throttle
from tests.conftest import auth


def test_security_lightweight_migration_adds_columns_and_unique_login_index() -> None:
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, display_name VARCHAR(100) NOT NULL)"))
        connection.execute(
            text(
                "CREATE TABLE device_tokens (token VARCHAR(128) PRIMARY KEY, user_id INTEGER NOT NULL, "
                "expires_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO device_tokens (token, user_id, expires_at, created_at) "
                "VALUES ('legacy', 1, NULL, CURRENT_TIMESTAMP)"
            )
        )

    database._ensure_columns(engine)
    database._ensure_security_indexes(engine)
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    token_columns = {column["name"] for column in inspect(engine).get_columns("device_tokens")}
    assert {"login_name", "password_hash", "password_updated_at"}.issubset(user_columns)
    assert "source" in token_columns
    with engine.connect() as connection:
        assert connection.execute(text("SELECT source FROM device_tokens WHERE token = 'legacy'")).scalar_one() == "entry"
        connection.execute(text("INSERT INTO users (id, display_name, login_name) VALUES (1, 'A', 'same')"))
        with pytest.raises(IntegrityError):
            connection.execute(text("INSERT INTO users (id, display_name, login_name) VALUES (2, 'B', 'same')"))


def test_login_name_normalization_and_password_setup(
    client: TestClient,
    db_session: Session,
    pair_tokens: dict[str, object],
) -> None:
    password_login_throttle.clear()
    entry_token = str(pair_tokens["user_a_token"])
    response = client.put(
        "/auth/me/security-password",
        headers=auth(entry_token),
        json={"login_name": " Ｌｏｖｅｒ_甲 ", "password": "一段足够长且只属于我们的安全密码"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["token_type"] == "bearer"
    assert data["security"]["login_name"] == "lover_甲"
    assert data["security"]["configured"] is True

    user = db_session.get(User, int(pair_tokens["user_a"]["id"]))
    assert user is not None
    assert user.password_hash
    assert "一段足够长" not in user.password_hash
    assert user.password_hash.startswith("$argon2id$")
    assert normalize_login_name(" Ｌｏｖｅｒ_甲 ") == user.login_name

    state = client.get("/auth/me/security-password", headers=auth(entry_token))
    assert state.json()["login_name"] == "lover_甲"
    logged_in = client.post(
        "/auth/login/password",
        json={"login_name": "LOVER_甲", "password": "一段足够长且只属于我们的安全密码"},
    )
    assert logged_in.status_code == 200
    expires_at = logged_in.json()["expires_at"]
    assert expires_at
    assert client.get("/auth/me", headers=auth(logged_in.json()["access_token"])).status_code == 200


def test_password_login_has_uniform_failure_and_progressive_throttle(
    client: TestClient,
    pair_tokens: dict[str, object],
) -> None:
    password_login_throttle.clear()
    token = str(pair_tokens["user_a_token"])
    client.put(
        "/auth/me/security-password",
        headers=auth(token),
        json={"login_name": "known.user", "password": "correct horse battery staple"},
    )
    wrong = client.post(
        "/auth/login/password",
        json={"login_name": "known.user", "password": "a definitely wrong password"},
    )
    unknown = client.post(
        "/auth/login/password",
        json={"login_name": "unknown.user", "password": "a definitely wrong password"},
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "登录名或安全密码不正确"

    password_login_throttle.clear()
    for _ in range(5):
        assert client.post(
            "/auth/login/password",
            json={"login_name": "known.user", "password": "a definitely wrong password"},
        ).status_code == 401
    blocked = client.post(
        "/auth/login/password",
        json={"login_name": "known.user", "password": "correct horse battery staple"},
    )
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) >= 1
    password_login_throttle.clear()


def test_password_reset_revokes_only_password_sessions(
    client: TestClient,
    db_session: Session,
    pair_tokens: dict[str, object],
) -> None:
    password_login_throttle.clear()
    entry_token = str(pair_tokens["user_a_token"])
    first = client.put(
        "/auth/me/security-password",
        headers=auth(entry_token),
        json={"login_name": "reset.user", "password": "first password is long enough"},
    ).json()
    second = client.post(
        "/auth/login/password",
        json={"login_name": "reset.user", "password": "first password is long enough"},
    ).json()
    reset = client.put(
        "/auth/me/security-password",
        headers=auth(entry_token),
        json={"login_name": "reset.user", "password": "second password is long enough"},
    )
    assert reset.status_code == 200
    new_token = reset.json()["access_token"]

    assert client.get("/auth/me", headers=auth(entry_token)).status_code == 200
    assert client.get("/auth/me", headers=auth(new_token)).status_code == 200
    assert client.get("/auth/me", headers=auth(first["access_token"])).status_code == 401
    assert client.get("/auth/me", headers=auth(second["access_token"])).status_code == 401
    sources = db_session.execute(select(DeviceToken.source)).scalars().all()
    assert sources.count("entry") == 2
    assert sources.count("password") == 1


def test_security_password_validation_and_unique_login(
    client: TestClient,
    pair_tokens: dict[str, object],
) -> None:
    token_a = str(pair_tokens["user_a_token"])
    token_b = str(pair_tokens["user_b_token"])
    assert client.put(
        "/auth/me/security-password",
        headers=auth(token_a),
        json={"login_name": "shared.name", "password": "safe password for person a"},
    ).status_code == 200
    duplicate = client.put(
        "/auth/me/security-password",
        headers=auth(token_b),
        json={"login_name": "ＳＨＡＲＥＤ.NAME", "password": "safe password for person b"},
    )
    assert duplicate.status_code == 409
    assert client.put(
        "/auth/me/security-password",
        headers=auth(token_b),
        json={"login_name": "person-b", "password": "123456789012345"},
    ).status_code == 422
    assert client.put(
        "/auth/me/security-password",
        headers=auth(token_b),
        json={"login_name": "bad login", "password": "safe password for person b"},
    ).status_code == 422
    assert client.put(
        "/auth/me/security-password",
        json={"login_name": "person-b", "password": "safe password for person b"},
    ).status_code == 401


def test_password_session_expires_in_ninety_days(
    client: TestClient,
    db_session: Session,
    pair_tokens: dict[str, object],
) -> None:
    response = client.put(
        "/auth/me/security-password",
        headers=auth(str(pair_tokens["user_a_token"])),
        json={"login_name": "expiry.user", "password": "safe password with expiry"},
    )
    token = db_session.get(DeviceToken, response.json()["access_token"])
    assert token is not None and token.expires_at is not None
    expires_at = token.expires_at.replace(tzinfo=utc_now().tzinfo) if token.expires_at.tzinfo is None else token.expires_at
    assert timedelta(days=89, hours=23) < expires_at - utc_now() <= timedelta(days=90)


def test_leaderboard_retains_top_three_and_orders_ties_by_age(
    client: TestClient,
    db_session: Session,
) -> None:
    for index, score in enumerate((100, 90, 80)):
        response = client.post("/game/leaderboard", json={"player_name": f"玩家{index}", "score": score})
        assert response.status_code == 201
        assert response.json()["entered"] is True

    tied_out = client.post("/game/leaderboard", json={"player_name": "后来同分", "score": 80})
    assert tied_out.json()["entered"] is False
    assert tied_out.json()["rank"] is None
    assert tied_out.json()["threshold"] == 80
    assert db_session.scalar(select(GameScore).where(GameScore.player_name == "后来同分")) is None

    winner = client.post("/game/leaderboard", json={"player_name": "  小花  ", "score": 999}).json()
    assert winner["entered"] is True
    assert winner["rank"] == 1
    assert winner["items"][0]["player_name"] == "小花"
    assert len(winner["items"]) == 3
    assert len(db_session.execute(select(GameScore)).scalars().all()) == 3

    ignored = client.post("/game/leaderboard", json={"player_name": "未入榜", "score": 0}).json()
    assert ignored["entered"] is False
    assert len(db_session.execute(select(GameScore)).scalars().all()) == 3


def test_leaderboard_validation_and_empty_threshold(client: TestClient) -> None:
    assert client.get("/game/leaderboard").json() == {"items": [], "threshold": 0}
    assert client.post("/game/leaderboard", json={"player_name": "   ", "score": 1}).status_code == 422
    assert client.post("/game/leaderboard", json={"player_name": "a" * 13, "score": 1}).status_code == 422
    assert client.post("/game/leaderboard", json={"player_name": "ok", "score": -1}).status_code == 422
    assert client.post("/game/leaderboard", json={"player_name": "ok", "score": 2_147_483_648}).status_code == 422
