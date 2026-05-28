"""Database engine setup, sessions, table creation, and lightweight media storage column migrations."""

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()


def _build_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        return create_engine(database_url, connect_args={"check_same_thread": False})
    # MySQL / Postgres etc. - keep connections healthy through long-lived idle periods.
    return create_engine(database_url, pool_pre_ping=True, pool_recycle=3600)


engine = _build_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Lightweight column-existence migration for environments without Alembic.
# Each entry: (table, column_name, {dialect_name: "<DDL fragment>"}).
# "default" is used as a fallback when the dialect-specific fragment is missing.
_LIGHTWEIGHT_COLUMNS: list[tuple[str, str, dict[str, str]]] = [
    (
        "users",
        "avatar",
        {"default": "VARCHAR(64) NOT NULL DEFAULT ''"},
    ),
    (
        "users",
        "email",
        {"default": "VARCHAR(255) NULL"},
    ),
    (
        "device_tokens",
        "expires_at",
        {
            "default": "TIMESTAMP WITH TIME ZONE NULL",
            "mysql": "DATETIME NULL",
            "mariadb": "DATETIME NULL",
        },
    ),
    (
        "pairs",
        "love_started_on",
        {"default": "DATE NULL"},
    ),
    # Legacy image BLOB columns stay readable while new uploads use storage keys.
    (
        "images",
        "data",
        {
            "default": "BLOB NULL",
            "mysql": "LONGBLOB NULL",
            "mariadb": "LONGBLOB NULL",
        },
    ),
    (
        "voices",
        "data",
        {
            "default": "BLOB NULL",
            "mysql": "LONGBLOB NULL",
            "mariadb": "LONGBLOB NULL",
        },
    ),
    (
        "images",
        "thumb_data",
        {
            "default": "BLOB NULL",
            "mysql": "LONGBLOB NULL",
            "mariadb": "LONGBLOB NULL",
        },
    ),
    (
        "images",
        "thumb_mime_type",
        {"default": "VARCHAR(100) NOT NULL DEFAULT 'image/jpeg'"},
    ),
    (
        "images",
        "thumb_size_bytes",
        {"default": "INTEGER NOT NULL DEFAULT 0", "mysql": "INT NOT NULL DEFAULT 0", "mariadb": "INT NOT NULL DEFAULT 0"},
    ),
    (
        "images",
        "storage_key",
        {"default": "VARCHAR(500) NULL"},
    ),
    (
        "images",
        "thumb_storage_key",
        {"default": "VARCHAR(500) NULL"},
    ),
    (
        "images",
        "storage_backend",
        {"default": "VARCHAR(50) NOT NULL DEFAULT 'local'"},
    ),
]


def _ensure_columns(target_engine: Engine) -> None:
    inspector = inspect(target_engine)
    existing_tables = set(inspector.get_table_names())
    dialect_name = target_engine.dialect.name
    for table_name, column_name, ddl_by_dialect in _LIGHTWEIGHT_COLUMNS:
        if table_name not in existing_tables:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if column_name in existing_columns:
            continue
        ddl_fragment = ddl_by_dialect.get(dialect_name, ddl_by_dialect["default"])
        with target_engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_fragment}"))


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_columns(engine)
