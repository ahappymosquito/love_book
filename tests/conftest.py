"""Pytest fixtures for isolated database sessions, local media storage, TestClient overrides, and auth headers."""

from collections.abc import Generator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def client(db_session: Session, tmp_path: Path) -> Generator[TestClient, None, None]:
    settings = get_settings()
    original_settings = settings.model_copy()
    settings.admin_key = "test-admin-key"
    settings.media_root = str(tmp_path / "media")
    settings.media_storage = "local"

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
            db_session.commit()
        except Exception:
            db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db
    original_lifespan_context = app.router.lifespan_context

    @asynccontextmanager
    async def noop_lifespan(_: FastAPI):
        yield

    app.router.lifespan_context = noop_lifespan
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        for field_name in type(settings).model_fields:
            setattr(settings, field_name, getattr(original_settings, field_name))
        app.router.lifespan_context = original_lifespan_context
        app.dependency_overrides.clear()


@pytest.fixture
def pair_tokens(client: TestClient) -> dict[str, str | int]:
    response = client.post(
        "/admin/pairs",
        headers={"X-Admin-Key": "test-admin-key"},
        json={"user_a_display_name": "A", "user_b_display_name": "B"},
    )
    assert response.status_code == 200
    return response.json()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
