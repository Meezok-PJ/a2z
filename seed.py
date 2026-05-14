"""Database seeding script (idempotent).

Runs as a one-shot before the web server boots. Seeds roles, global
departments, and — if `ADMIN_USERNAME` / `ADMIN_MASTER_PASSWORD_HASH` are
present — the Admin user.
"""

from app import create_app
from app.auth_utils import ensure_admin_user
from app.bootstrap_data import ensure_reference_data
from app.extensions import db


def seed_database() -> None:
    app = create_app()
    with app.app_context():
        print("Creating tables...")
        db.create_all()

        print("Seeding roles and departments...")
        ensure_reference_data()

        print("Seeding Admin (if ADMIN_* env vars are set)...")
        ensure_admin_user()

        print("Database seeding completed.")


if __name__ == "__main__":
    seed_database()
