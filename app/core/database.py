"""Database setup, sessions, default quote seeding, and lightweight migrations for media, todo, AI model lists, and avatars."""

"""Database engine, session factory, and lightweight migrations for evolving auth, media, AI, and rich AMap restaurant schemas."""

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


# Lightweight column-existence migration for environments without Alembic, including rich AMap restaurant evidence columns.
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
        "users",
        "avatar_storage_key",
        {"default": "VARCHAR(500) NULL"},
    ),
    (
        "users",
        "avatar_mime_type",
        {"default": "VARCHAR(100) NULL"},
    ),
    (
        "users",
        "avatar_size_bytes",
        {"default": "INTEGER NULL", "mysql": "INT NULL", "mariadb": "INT NULL"},
    ),
    (
        "users",
        "avatar_updated_at",
        {
            "default": "TIMESTAMP WITH TIME ZONE NULL",
            "mysql": "DATETIME NULL",
            "mariadb": "DATETIME NULL",
        },
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
        "voices",
        "storage_key",
        {"default": "VARCHAR(500) NULL"},
    ),
    (
        "voices",
        "storage_backend",
        {"default": "VARCHAR(50) NOT NULL DEFAULT 'local'"},
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
    (
        "ai_settings",
        "openai_base_url",
        {"default": "VARCHAR(500) NOT NULL DEFAULT ''"},
    ),
    (
        "ai_settings",
        "anthropic_base_url",
        {"default": "VARCHAR(500) NOT NULL DEFAULT ''"},
    ),
    (
        "ai_settings",
        "api_key",
        {"default": "VARCHAR(4000) NOT NULL DEFAULT ''"},
    ),
    (
        "ai_settings",
        "amap_api_key",
        {"default": "VARCHAR(200) NOT NULL DEFAULT ''"},
    ),
    (
        "ai_settings",
        "openai_models",
        {"sqlite": "JSON NOT NULL DEFAULT '[]'", "mysql": "JSON NULL", "default": "JSON NULL"},
    ),
    (
        "ai_settings",
        "anthropic_models",
        {"sqlite": "JSON NOT NULL DEFAULT '[]'", "mysql": "JSON NULL", "default": "JSON NULL"},
    ),
    ("todo_restaurants", "adname", {"default": "VARCHAR(100) NULL"}),
    ("todo_restaurants", "pname", {"default": "VARCHAR(100) NULL"}),
    ("todo_restaurants", "poi_typecode", {"default": "VARCHAR(50) NULL"}),
    ("todo_restaurants", "rating", {"default": "FLOAT NULL"}),
    ("todo_restaurants", "opening_hours", {"default": "VARCHAR(300) NULL"}),
    ("todo_restaurants", "meal_ordering", {"default": "VARCHAR(50) NULL"}),
    (
        "todo_restaurants",
        "photos_count",
        {"default": "INTEGER NOT NULL DEFAULT 0", "mysql": "INT NOT NULL DEFAULT 0", "mariadb": "INT NOT NULL DEFAULT 0"},
    ),
    ("todo_restaurants", "first_photo_url", {"default": "VARCHAR(1000) NULL"}),
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
            if column_name in {"openai_models", "anthropic_models"}:
                if dialect_name == "mysql":
                    connection.execute(text(f"UPDATE {table_name} SET {column_name} = JSON_ARRAY() WHERE {column_name} IS NULL"))
                else:
                    connection.execute(text(f"UPDATE {table_name} SET {column_name} = '[]' WHERE {column_name} IS NULL"))


def init_db() -> None:
    from app import models  # noqa: F401
    from app.services import ensure_default_quotes

    Base.metadata.create_all(bind=engine)
    _ensure_columns(engine)
    with SessionLocal() as db:
        ensure_default_quotes(db)
        db.commit()
