from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
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


# Lightweight column-existence migration for SQLite/Postgres without Alembic.
# Each entry: (table, column_name, "<DDL fragment>")
_LIGHTWEIGHT_COLUMNS: list[tuple[str, str, str]] = [
    ("users", "avatar", "VARCHAR(64) NOT NULL DEFAULT ''"),
    ("device_tokens", "expires_at", "TIMESTAMP WITH TIME ZONE NULL"),
]


def _ensure_columns(target_engine: Engine) -> None:
    inspector = inspect(target_engine)
    existing_tables = set(inspector.get_table_names())
    for table_name, column_name, ddl_fragment in _LIGHTWEIGHT_COLUMNS:
        if table_name not in existing_tables:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if column_name in existing_columns:
            continue
        with target_engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_fragment}"))


def init_db() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_columns(engine)
