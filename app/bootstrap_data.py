"""Shared reference-data bootstrap helpers."""

from __future__ import annotations

from .extensions import db
from .models import Department, Role

REQUIRED_DEPARTMENTS = ("IT_Department", "HR_Department", "Management")
GLOBAL_DEPARTMENTS = REQUIRED_DEPARTMENTS + ("Finance",)
GLOBAL_ROLES = ("Admin", "User")


def ensure_reference_data() -> None:
    """Idempotently ensure required roles/departments exist."""
    changed = False

    for role_name in GLOBAL_ROLES:
        if not Role.query.filter_by(name=role_name).first():
            db.session.add(Role(name=role_name))
            changed = True

    for dept_name in GLOBAL_DEPARTMENTS:
        if not Department.query.filter_by(name=dept_name).first():
            db.session.add(Department(name=dept_name))
            changed = True

    if changed:
        db.session.commit()
