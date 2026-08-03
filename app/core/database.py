"""Database setup, lightweight schema/index migrations, and retired-feature compatibility cleanup."""

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, select, text
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


def delete_legacy_voice_rows(db: Session, event_id: int) -> None:
    """Remove retired voice rows only when an existing deployment still has the legacy table."""
    bind = db.get_bind()
    if inspect(bind).has_table("voices"):
        db.execute(text("DELETE FROM voices WHERE event_id = :event_id"), {"event_id": event_id})


# Lightweight column-existence migration for environments without Alembic, including received-gift metadata and rich AMap evidence.
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
    ("users", "login_name", {"default": "VARCHAR(32) NULL"}),
    ("users", "password_hash", {"default": "VARCHAR(500) NULL"}),
    (
        "users",
        "password_updated_at",
        {
            "default": "TIMESTAMP WITH TIME ZONE NULL",
            "mysql": "DATETIME NULL",
            "mariadb": "DATETIME NULL",
        },
    ),
    (
        "users",
        "location_label",
        {"default": "VARCHAR(200) NULL"},
    ),
    (
        "users",
        "location_address",
        {"default": "VARCHAR(500) NULL"},
    ),
    (
        "users",
        "location_city",
        {"default": "VARCHAR(100) NULL"},
    ),
    (
        "users",
        "location_coords",
        {"default": "VARCHAR(100) NULL"},
    ),
    (
        "users",
        "location_updated_at",
        {
            "default": "TIMESTAMP WITH TIME ZONE NULL",
            "mysql": "DATETIME NULL",
            "mariadb": "DATETIME NULL",
        },
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
    ("device_tokens", "source", {"default": "VARCHAR(20) NOT NULL DEFAULT 'entry'"}),
    (
        "love_receipts",
        "receipt_rating",
        {"default": "INTEGER NULL", "mysql": "TINYINT NULL", "mariadb": "TINYINT NULL"},
    ),
    (
        "love_receipts",
        "timeline_migrated_at",
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
    (
        "events",
        "event_kind",
        {"default": "VARCHAR(50) NOT NULL DEFAULT 'memory'"},
    ),
    (
        "events",
        "meeting_session_id",
        {"default": "INTEGER NULL", "mysql": "INT NULL", "mariadb": "INT NULL"},
    ),
    (
        "events",
        "gift_rating",
        {"default": "INTEGER NULL", "mysql": "TINYINT NULL", "mariadb": "TINYINT NULL"},
    ),
    (
        "events",
        "gift_feelings",
        {"sqlite": "JSON NULL", "mysql": "JSON NULL", "mariadb": "JSON NULL", "default": "JSON NULL"},
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
        "images",
        "legacy_love_receipt_image_id",
        {"default": "INTEGER NULL", "mysql": "INT NULL", "mariadb": "INT NULL"},
    ),
    (
        "images",
        "sort_order",
        {"default": "INTEGER NOT NULL DEFAULT 0", "mysql": "INT NOT NULL DEFAULT 0", "mariadb": "INT NOT NULL DEFAULT 0"},
    ),
    (
        "ai_settings",
        "llm_enabled",
        {"default": "BOOLEAN NOT NULL DEFAULT 0", "mysql": "BOOLEAN NOT NULL DEFAULT FALSE", "mariadb": "BOOLEAN NOT NULL DEFAULT FALSE"},
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


def _todo_category_enum_migration_sql(dialect_name: str) -> list[str]:
    if dialect_name not in {"mysql", "mariadb"}:
        return []
    enum_values = "ENUM('food','play','stay','wish') NOT NULL"
    return [
        f"ALTER TABLE todo_items MODIFY category {enum_values}",
        f"ALTER TABLE todo_candidates MODIFY category {enum_values}",
    ]


def _love_receipt_mood_enum_migration_sql(dialect_name: str) -> list[str]:
    if dialect_name not in {"mysql", "mariadb"}:
        return []
    values = (
        "'happy','surprised','touched','reassured','cherished','hug',"
        "'disappointed','wronged','pressured','not_my_style','upset','complicated'"
    )
    return [f"ALTER TABLE love_receipts MODIFY receipt_mood ENUM({values}) NULL"]


def _event_kind_enum_migration_sql(dialect_name: str) -> list[str]:
    if dialect_name not in {"mysql", "mariadb"}:
        return []
    return [
        "ALTER TABLE events MODIFY event_kind "
        "ENUM('memory','offline_meeting','gift_received') NOT NULL DEFAULT 'memory'"
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


def _ensure_security_indexes(target_engine: Engine) -> None:
    """Add the nullable normalized-login unique index to upgraded databases."""
    inspector = inspect(target_engine)
    if "users" not in set(inspector.get_table_names()):
        return
    indexes = {index["name"] for index in inspector.get_indexes("users")}
    unique_columns = {
        tuple(constraint.get("column_names") or [])
        for constraint in inspector.get_unique_constraints("users")
    }
    if "uq_users_login_name" in indexes or ("login_name",) in unique_columns:
        return
    with target_engine.begin() as connection:
        connection.execute(text("CREATE UNIQUE INDEX uq_users_login_name ON users (login_name)"))


def _ensure_todo_category_enum(target_engine: Engine) -> None:
    ddl_statements = _todo_category_enum_migration_sql(target_engine.dialect.name)
    if not ddl_statements:
        return
    inspector = inspect(target_engine)
    existing_tables = set(inspector.get_table_names())
    if not {"todo_items", "todo_candidates"}.issubset(existing_tables):
        return
    with target_engine.begin() as connection:
        for ddl_statement in ddl_statements:
            connection.execute(text(ddl_statement))


def _ensure_love_receipt_mood_enum(target_engine: Engine) -> None:
    ddl_statements = _love_receipt_mood_enum_migration_sql(target_engine.dialect.name)
    if not ddl_statements or "love_receipts" not in set(inspect(target_engine).get_table_names()):
        return
    with target_engine.begin() as connection:
        for ddl_statement in ddl_statements:
            connection.execute(text(ddl_statement))


def _ensure_received_gift_schema(target_engine: Engine) -> None:
    existing_tables = set(inspect(target_engine).get_table_names())
    if "events" not in existing_tables:
        return
    with target_engine.begin() as connection:
        for ddl_statement in _event_kind_enum_migration_sql(target_engine.dialect.name):
            connection.execute(text(ddl_statement))
    if "images" not in existing_tables:
        return
    image_inspector = inspect(target_engine)
    image_indexes = {index["name"] for index in image_inspector.get_indexes("images")}
    image_unique_columns = {
        tuple(constraint.get("column_names") or [])
        for constraint in image_inspector.get_unique_constraints("images")
    }
    if (
        "uq_images_legacy_love_receipt_image_id" not in image_indexes
        and ("legacy_love_receipt_image_id",) not in image_unique_columns
    ):
        with target_engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX uq_images_legacy_love_receipt_image_id "
                    "ON images (legacy_love_receipt_image_id)"
                )
            )


def _migrate_love_receipts_to_events(db: Session) -> None:
    """Convert every legacy receipt and its media into an idempotent received-gift event."""
    import logging

    from app.media import MediaProcessingError, make_image_thumbnail
    from app.models import Event, EventKind, Image, LoveReceipt, VisibilityMode, utc_now
    from app.services import find_meeting_for_date, meeting_date_for_values
    from app.storage import (
        MediaStorageError,
        build_legacy_receipt_event_image_storage_keys,
        delete_media_file,
        read_media_file,
        write_media_file,
    )

    logger = logging.getLogger(__name__)
    receipts = db.execute(select(LoveReceipt).order_by(LoveReceipt.created_at, LoveReceipt.id)).scalars().all()
    for receipt in receipts:
        receipt_written_keys: list[str] = []
        if receipt.timeline_event_id is None and receipt.timeline_migrated_at is not None:
            continue
        occurred_at = (
            receipt.completed_at
            or receipt.received_at
            or receipt.delivered_at
            or receipt.expected_arrival_at
            or receipt.created_at
        )
        parts: list[str] = []
        response = (receipt.receipt_content or "").strip()
        message = (receipt.message or "").strip()
        if response:
            parts.append(response)
        if message and message != response:
            parts.append(f"送礼时的话：{message}")
        description = "\n\n".join(parts) or None
        gift_feelings = [receipt.receipt_mood.value] if receipt.receipt_mood is not None else []

        event = db.get(Event, receipt.timeline_event_id) if receipt.timeline_event_id else None
        event_date = meeting_date_for_values(occurred_at, receipt.created_at)
        meeting = find_meeting_for_date(db, receipt.pair_id, event_date)
        if event is None:
            event = Event(
                pair_id=receipt.pair_id,
                creator_id=receipt.receiver_id,
                meeting_session_id=meeting.id if meeting else None,
                title=receipt.title,
                description=description,
                occurred_at=occurred_at,
                event_kind=EventKind.gift_received,
                gift_rating=receipt.receipt_rating,
                gift_feelings=gift_feelings,
                visibility_mode=VisibilityMode.public,
                created_at=receipt.created_at,
            )
            db.add(event)
            db.flush()
            receipt.timeline_event_id = event.id
        else:
            event.creator_id = receipt.receiver_id
            event.title = receipt.title
            event.description = description
            event.occurred_at = occurred_at
            event.event_kind = EventKind.gift_received
            event.gift_rating = receipt.receipt_rating
            event.gift_feelings = gift_feelings
            event.visibility_mode = VisibilityMode.public
            event.meeting_session_id = meeting.id if meeting else None
        receipt.timeline_migrated_at = receipt.timeline_migrated_at or utc_now()

        ordered_images = sorted(
            receipt.images,
            key=lambda image: (0 if image.kind.value == "cover" else 1, image.sort_order, image.id),
        )
        for image_order, legacy_image in enumerate(ordered_images):
            copied = db.execute(
                select(Image).where(Image.legacy_love_receipt_image_id == legacy_image.id)
            ).scalar_one_or_none()
            if copied is not None:
                continue
            try:
                original = read_media_file(legacy_image.storage_key)
                thumbnail = read_media_file(legacy_image.thumb_storage_key)
            except MediaStorageError as exc:
                logger.warning("Could not read legacy love-receipt image %s: %s", legacy_image.id, exc)
                continue
            if original is None:
                logger.warning("Legacy love-receipt image %s is missing; event migration continues", legacy_image.id)
                continue
            if thumbnail is None:
                try:
                    thumbnail = make_image_thumbnail(original)
                except MediaProcessingError as exc:
                    logger.warning("Could not rebuild thumbnail for legacy love-receipt image %s: %s", legacy_image.id, exc)
                    continue
            storage_key, thumb_key = build_legacy_receipt_event_image_storage_keys(
                receipt.pair_id,
                event.id,
                legacy_image.id,
                legacy_image.mime_type,
            )
            try:
                write_media_file(storage_key, original)
                receipt_written_keys.append(storage_key)
                write_media_file(thumb_key, thumbnail)
                receipt_written_keys.append(thumb_key)
            except (MediaStorageError, OSError) as exc:
                logger.warning("Could not copy legacy love-receipt image %s: %s", legacy_image.id, exc)
                for partial_key in (storage_key, thumb_key):
                    if partial_key in receipt_written_keys:
                        try:
                            delete_media_file(partial_key)
                        except (MediaStorageError, OSError):
                            pass
                        receipt_written_keys.remove(partial_key)
                continue
            db.add(
                Image(
                    event_id=event.id,
                    author_id=legacy_image.author_id,
                    legacy_love_receipt_image_id=legacy_image.id,
                    sort_order=image_order,
                    file_path="",
                    storage_key=storage_key,
                    thumb_storage_key=thumb_key,
                    storage_backend=legacy_image.storage_backend,
                    data=None,
                    thumb_data=None,
                    thumb_mime_type=legacy_image.thumb_mime_type,
                    thumb_size_bytes=legacy_image.thumb_size_bytes,
                    mime_type=legacy_image.mime_type,
                    size_bytes=legacy_image.size_bytes,
                    width=legacy_image.width,
                    height=legacy_image.height,
                    created_at=legacy_image.created_at,
                )
            )
        try:
            db.flush()
        except Exception:
            for storage_key in receipt_written_keys:
                try:
                    delete_media_file(storage_key)
                except (MediaStorageError, OSError):
                    pass
            raise


def _ensure_legacy_meeting_sessions(target_engine: Engine) -> None:
    inspector = inspect(target_engine)
    existing_tables = set(inspector.get_table_names())
    if not {"events", "meeting_sessions"}.issubset(existing_tables):
        return
    event_columns = {column["name"] for column in inspector.get_columns("events")}
    if "meeting_session_id" not in event_columns:
        return

    insert_id_sql = "SELECT LAST_INSERT_ID()" if target_engine.dialect.name in {"mysql", "mariadb"} else "SELECT last_insert_rowid()"
    with target_engine.begin() as connection:
        legacy_events = connection.execute(
            text(
                """
                SELECT id, pair_id, creator_id, title, occurred_at, created_at
                FROM events
                WHERE event_kind = 'offline_meeting' AND meeting_session_id IS NULL
                ORDER BY created_at ASC, id ASC
                """
            )
        ).mappings().all()
        for event in legacy_events:
            session_title = f"未整理：{event['title']}"
            connection.execute(
                text(
                    """
                    INSERT INTO meeting_sessions
                        (pair_id, title, started_on, ended_on, created_by_id, created_at, updated_at)
                    VALUES
                        (:pair_id, :title, NULL, NULL, :created_by_id, :created_at, :updated_at)
                    """
                ),
                {
                    "pair_id": event["pair_id"],
                    "title": session_title[:200],
                    "created_by_id": event["creator_id"],
                    "created_at": event["created_at"],
                    "updated_at": event["created_at"],
                },
            )
            session_id = connection.execute(text(insert_id_sql)).scalar_one()
            connection.execute(
                text("UPDATE events SET meeting_session_id = :session_id WHERE id = :event_id"),
                {"session_id": session_id, "event_id": event["id"]},
            )


def init_db() -> None:
    from app import models  # noqa: F401
    from app.services import ensure_default_quotes, normalize_meeting_ranges

    Base.metadata.create_all(bind=engine)
    _ensure_columns(engine)
    _ensure_security_indexes(engine)
    _ensure_todo_category_enum(engine)
    _ensure_love_receipt_mood_enum(engine)
    _ensure_received_gift_schema(engine)
    _ensure_legacy_meeting_sessions(engine)
    with SessionLocal() as db:
        _migrate_love_receipts_to_events(db)
        normalize_meeting_ranges(db)
        ensure_default_quotes(db)
        db.commit()
