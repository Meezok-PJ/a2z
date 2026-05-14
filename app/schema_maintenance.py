"""Schema compatibility helpers for environments without Alembic."""

from __future__ import annotations

from sqlalchemy import inspect, text

from .extensions import db


def _table_columns(table_name: str) -> set[str]:
    inspector = inspect(db.engine)
    try:
        return {column["name"] for column in inspector.get_columns(table_name)}
    except Exception:
        return set()


def _run_alter(sql: str) -> None:
    try:
        db.session.execute(text(sql))
        db.session.commit()
    except Exception:
        db.session.rollback()


def ensure_vault_schema() -> None:
    """Apply additive vault schema updates in place if needed."""
    vault_cols = _table_columns("vaults")
    if vault_cols and "owner_user_id" not in vault_cols:
        _run_alter("ALTER TABLE vaults ADD COLUMN owner_user_id INTEGER REFERENCES users(id)")

    encrypted_cols = _table_columns("encrypted_records")
    if encrypted_cols:
        if "record_scope" not in encrypted_cols:
            _run_alter("ALTER TABLE encrypted_records ADD COLUMN record_scope VARCHAR(32) DEFAULT 'shared'")
            _run_alter("UPDATE encrypted_records SET record_scope='shared' WHERE record_scope IS NULL")
            _run_alter("ALTER TABLE encrypted_records ALTER COLUMN record_scope SET NOT NULL")
        if "service_name" not in encrypted_cols:
            _run_alter("ALTER TABLE encrypted_records ADD COLUMN service_name VARCHAR(255)")
        if "service_username" not in encrypted_cols:
            _run_alter("ALTER TABLE encrypted_records ADD COLUMN service_username VARCHAR(255)")
        if "service_url" not in encrypted_cols:
            _run_alter("ALTER TABLE encrypted_records ADD COLUMN service_url VARCHAR(512)")

