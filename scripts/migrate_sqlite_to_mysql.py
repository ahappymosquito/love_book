"""One-off migration script: copy every row from the local SQLite database to MySQL.

Usage (from project root)::

    python scripts/migrate_sqlite_to_mysql.py            # abort if target tables already contain data
    python scripts/migrate_sqlite_to_mysql.py --truncate # wipe target tables before copying

The source is taken from ``SQLITE_SOURCE_URL`` (falling back to ``sqlite:///./pair_events.db``),
the destination is the configured ``DATABASE_URL`` (which must point at MySQL).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import MetaData, Table, create_engine, func, select
from sqlalchemy.engine import Engine

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(PROJECT_ROOT / ".env", override=True)

from app.core.database import Base, _build_engine  # noqa: E402
from app import models  # noqa: E402,F401  - register tables on Base.metadata


def _build_source_engine() -> Engine:
    source_url = os.getenv("SQLITE_SOURCE_URL", "sqlite:///./pair_events.db")
    if not source_url.startswith("sqlite"):
        raise SystemExit(f"SQLITE_SOURCE_URL must be a sqlite URL, got: {source_url}")
    return create_engine(source_url, connect_args={"check_same_thread": False})


def _build_target_engine() -> Engine:
    target_url = os.getenv("DATABASE_URL", "")
    if not target_url.startswith(("mysql", "mariadb")):
        raise SystemExit(
            "DATABASE_URL must point at MySQL/MariaDB before running the migration. "
            f"Current value: {target_url!r}"
        )
    return _build_engine(target_url)


def _reflect_source_tables(source: Engine) -> dict[str, Table]:
    """Reflect the legacy SQLite schema so we can copy data even if columns differ slightly."""

    metadata = MetaData()
    metadata.reflect(bind=source)
    return {name: metadata.tables[name] for name in metadata.tables}


def _copy_table(
    source: Engine,
    target: Engine,
    target_table: Table,
    source_tables: dict[str, Table],
) -> int:
    if target_table.name not in source_tables:
        print(f"  - {target_table.name}: skipped (table not found in source)")
        return 0

    source_table = source_tables[target_table.name]
    target_columns = {column.name for column in target_table.columns}

    with source.connect() as source_conn:
        rows = source_conn.execute(select(source_table)).mappings().all()

    if not rows:
        print(f"  - {target_table.name}: 0 rows")
        return 0

    payload = []
    for row in rows:
        mapped = {key: row[key] for key in row.keys() if key in target_columns}
        # Fill in columns that exist in the new schema but were absent from the legacy DB
        # (e.g. the `avatar` column on users) using their declared defaults.
        for column in target_table.columns:
            if column.name in mapped:
                continue
            if column.default is not None and getattr(column.default, "arg", None) is not None:
                mapped[column.name] = column.default.arg
            elif column.server_default is not None and getattr(column.server_default, "arg", None) is not None:
                mapped[column.name] = column.server_default.arg
        payload.append(mapped)

    with target.begin() as target_conn:
        target_conn.execute(target_table.insert(), payload)

    print(f"  - {target_table.name}: {len(payload)} rows copied")
    return len(payload)


def _reset_auto_increment(target: Engine, table: Table) -> None:
    """Make sure MySQL keeps issuing fresh PKs after we inserted rows that included explicit ids."""

    primary_key_columns = [column for column in table.columns if column.primary_key]
    if len(primary_key_columns) != 1:
        return
    pk_column = primary_key_columns[0]
    if not pk_column.autoincrement or pk_column.type.python_type is not int:
        return

    with target.begin() as conn:
        max_id = conn.execute(select(func.coalesce(func.max(pk_column), 0))).scalar_one()
        next_id = int(max_id) + 1
        conn.exec_driver_sql(f"ALTER TABLE `{table.name}` AUTO_INCREMENT = {next_id}")


def _ensure_target_empty_or_truncate(target: Engine, truncate: bool) -> None:
    insertion_order = list(Base.metadata.sorted_tables)
    populated: list[str] = []
    with target.connect() as conn:
        for table in insertion_order:
            count = conn.execute(select(func.count()).select_from(table)).scalar_one()
            if count:
                populated.append(f"{table.name} ({count} rows)")

    if not populated:
        return

    if not truncate:
        raise SystemExit(
            "Target database already contains data in: "
            + ", ".join(populated)
            + ". Re-run with --truncate to wipe these tables before migrating."
        )

    print("Truncating target tables (FK checks temporarily disabled)...")
    with target.begin() as conn:
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        for table in reversed(insertion_order):
            conn.exec_driver_sql(f"TRUNCATE TABLE `{table.name}`")
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Wipe destination tables before copying (otherwise abort if they are not empty).",
    )
    args = parser.parse_args()

    source = _build_source_engine()
    target = _build_target_engine()

    print(f"Source: {source.url}")
    print(f"Target: {target.url}")

    print("Ensuring destination schema exists...")
    Base.metadata.create_all(bind=target)

    _ensure_target_empty_or_truncate(target, truncate=args.truncate)

    source_tables = _reflect_source_tables(source)

    print("Copying data:")
    total = 0
    for table in Base.metadata.sorted_tables:
        total += _copy_table(source, target, table, source_tables)

    print("Resetting AUTO_INCREMENT counters...")
    for table in Base.metadata.sorted_tables:
        _reset_auto_increment(target, table)

    print(f"Done. Copied {total} rows across {len(list(Base.metadata.sorted_tables))} tables.")


if __name__ == "__main__":
    main()
