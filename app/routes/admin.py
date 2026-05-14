"""Admin provisioning + MFA-reset approval endpoints."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import or_

from ..auth_utils import require_recent_mfa, require_role, verify_auth_key
from ..bootstrap_data import REQUIRED_DEPARTMENTS, ensure_reference_data
from ..extensions import db
from ..models import AccountResetRequest, AuditLog, Department, EncryptedRecord, Role, User, UserFavoriteRecord, Vault

admin_bp = Blueprint("admin", __name__)
PREDEFINED_DEPARTMENT_ORDER = list(REQUIRED_DEPARTMENTS)


def _get_or_create_org_vault(department_id: int) -> Vault:
    vault = Vault.query.filter_by(type="Organizational", department_id=department_id).first()
    if vault:
        return vault
    vault = Vault(type="Organizational", department_id=department_id)
    db.session.add(vault)
    db.session.flush()
    return vault


def _serialize_shared_record(rec: EncryptedRecord) -> dict:
    return {
        "id": rec.id,
        "ciphertext_blob": rec.ciphertext_blob,
        "iv_blob": rec.iv_blob,
        "service_name": rec.service_name,
        "service_username": rec.service_username,
        "service_url": rec.service_url,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }


def _serialize_private_metadata(rec: EncryptedRecord) -> dict:
    return {
        "id": rec.id,
        "owner_user_id": rec.user_id,
        "owner_username": rec.user.username if rec.user else None,
        "service_name": rec.service_name,
        "service_username": rec.service_username,
        "service_url": rec.service_url,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }


# ── Users ────────────────────────────────────────────────────────────────────
@admin_bp.post("/users")
@require_role("Admin")
def create_user():
    """Provision a new user. Only `username` and `department_id` are required;
    the user will complete onboarding via the FTL flow.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    department_id = data.get("department_id")

    if not username or department_id is None:
        return jsonify(error="missing_fields"), 400

    if User.query.filter_by(username=username).first():
        return jsonify(error="username_taken"), 409

    if not db.session.get(Department, department_id):
        return jsonify(error="invalid_department"), 400

    user_role = Role.query.filter_by(name="User").first()
    if not user_role:
        user_role = Role(name="User")
        db.session.add(user_role)
        db.session.flush()

    user = User(
        username=username,
        department_id=department_id,
        role_id=user_role.id,
        is_setup=False,
        totp_enabled=False,
    )
    db.session.add(user)
    db.session.commit()

    return jsonify(
        id=user.id,
        username=user.username,
        department_id=user.department_id,
        is_setup=user.is_setup,
    ), 201


@admin_bp.get("/users")
@require_role("Admin")
def list_users():
    users = User.query.order_by(User.id).all()
    return jsonify(users=[
        {
            "id": u.id,
            "username": u.username,
            "role": u.role.name if u.role else None,
            "department_id": u.department_id,
            "department": u.department.name if u.department else None,
            "is_setup": u.is_setup,
            "totp_enabled": u.totp_enabled,
            "mfa_reset_requested": u.mfa_reset_requested,
        }
        for u in users
    ])


@admin_bp.patch("/users/<int:user_id>")
@require_role("Admin")
def edit_user(user_id: int):
    """Switch a user's primary department (Phase 3 requirement)."""
    data = request.get_json(silent=True) or {}
    department_id = data.get("department_id")
    if department_id is None:
        return jsonify(error="missing_fields"), 400

    user = db.session.get(User, user_id)
    if not user:
        return jsonify(error="unknown_user"), 404
    if not db.session.get(Department, department_id):
        return jsonify(error="invalid_department"), 400

    user.department_id = department_id
    _get_or_create_org_vault(int(department_id))
    db.session.commit()
    return jsonify(
        id=user.id,
        username=user.username,
        department_id=user.department_id,
    )


# ── Departments (read-only helper for the Admin UI) ──────────────────────────
@admin_bp.get("/departments")
@require_role("Admin")
def list_departments():
    ensure_reference_data()
    depts = Department.query.order_by(Department.name.asc()).all()
    priority = {name: idx for idx, name in enumerate(PREDEFINED_DEPARTMENT_ORDER)}
    depts = sorted(
        depts,
        key=lambda dept: (priority.get(dept.name, len(PREDEFINED_DEPARTMENT_ORDER)), dept.name.lower()),
    )
    return jsonify(departments=[{"id": d.id, "name": d.name} for d in depts])


# ── Organizational Vault Management (Admin) ──────────────────────────────────
@admin_bp.get("/vault-records")
@require_role("Admin")
def list_department_vault_records():
    department_id = request.args.get("department_id", type=int)
    if not department_id:
        return jsonify(error="missing_department"), 400
    if not db.session.get(Department, department_id):
        return jsonify(error="invalid_department"), 400

    vault = _get_or_create_org_vault(department_id)
    db.session.commit()
    records = (
        EncryptedRecord.query.filter_by(vault_id=vault.id)
        .order_by(EncryptedRecord.created_at.desc())
        .all()
    )
    department_user_ids = [user.id for user in User.query.filter_by(department_id=department_id).all()]
    private_records = []
    if department_user_ids:
        private_records = (
            EncryptedRecord.query.join(Vault, Vault.id == EncryptedRecord.vault_id).filter(
                EncryptedRecord.user_id.in_(department_user_ids),
                or_(
                    EncryptedRecord.record_scope == "private",
                    Vault.type == "Personal",
                ),
            )
            .order_by(EncryptedRecord.created_at.desc())
            .all()
        )
    return jsonify(
        department_id=department_id,
        vault_id=vault.id,
        records=[_serialize_shared_record(rec) for rec in records if (rec.record_scope or "shared") == "shared"],
        private_records=[_serialize_private_metadata(rec) for rec in private_records],
    )


@admin_bp.post("/vault-records")
@require_role("Admin")
def create_department_vault_record():
    data = request.get_json(silent=True) or {}
    department_id = data.get("department_id")
    ciphertext_blob = data.get("ciphertext_blob")
    iv_blob = data.get("iv_blob")
    service_name = (data.get("service_name") or "").strip()
    service_username = (data.get("service_username") or "").strip()
    service_url = (data.get("service_url") or "").strip()
    if not department_id or not ciphertext_blob or not iv_blob:
        return jsonify(error="missing_fields"), 400
    if not db.session.get(Department, department_id):
        return jsonify(error="invalid_department"), 400

    vault = _get_or_create_org_vault(int(department_id))
    user: User = g.current_user
    rec = EncryptedRecord(
        vault_id=vault.id,
        user_id=user.id,
        record_scope="shared",
        service_name=service_name or None,
        service_username=service_username or None,
        service_url=service_url or None,
        ciphertext_blob=ciphertext_blob,
        iv_blob=iv_blob,
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(id=rec.id), 201


@admin_bp.patch("/vault-records/<int:record_id>")
@require_role("Admin")
def update_department_vault_record(record_id: int):
    data = request.get_json(silent=True) or {}
    ciphertext_blob = data.get("ciphertext_blob")
    iv_blob = data.get("iv_blob")
    service_name = (data.get("service_name") or "").strip()
    service_username = (data.get("service_username") or "").strip()
    service_url = (data.get("service_url") or "").strip()
    if not ciphertext_blob or not iv_blob:
        return jsonify(error="missing_fields"), 400

    rec = db.session.get(EncryptedRecord, record_id)
    if not rec:
        return jsonify(error="unknown_record"), 404

    vault = db.session.get(Vault, rec.vault_id)
    if not vault or vault.type != "Organizational" or (rec.record_scope or "shared") != "shared":
        return jsonify(error="forbidden_record"), 403

    rec.ciphertext_blob = ciphertext_blob
    rec.iv_blob = iv_blob
    rec.service_name = service_name or rec.service_name
    rec.service_username = service_username or rec.service_username
    rec.service_url = service_url or rec.service_url
    db.session.commit()
    return jsonify(ok=True, id=rec.id)


@admin_bp.delete("/vault-records/<int:record_id>")
@require_role("Admin")
@require_recent_mfa(max_age_seconds=300)
def delete_department_vault_record(record_id: int):
    rec = db.session.get(EncryptedRecord, record_id)
    if not rec:
        return jsonify(error="unknown_record"), 404
    vault = db.session.get(Vault, rec.vault_id)
    if not vault or vault.type != "Organizational" or (rec.record_scope or "shared") != "shared":
        return jsonify(error="forbidden_record"), 403

    db.session.delete(rec)
    db.session.commit()
    return jsonify(ok=True, id=record_id)


# ── MFA reset approvals ──────────────────────────────────────────────────────
@admin_bp.get("/mfa-requests")
@require_role("Admin")
def list_mfa_requests():
    pending = User.query.filter_by(mfa_reset_requested=True).all()
    return jsonify(requests=[
        {
            "id": u.id,
            "username": u.username,
            "department": u.department.name if u.department else None,
        }
        for u in pending
    ])


@admin_bp.post("/mfa-requests/<int:user_id>/approve")
@require_role("Admin")
@require_recent_mfa(max_age_seconds=300)
def approve_mfa_reset(user_id: int):
    """Approve a pending MFA reset: wipe the TOTP secret so the user is
    forced through a fresh TOTP enrollment on next login (handled by the FTL
    / re-provisioning flow)."""
    user = db.session.get(User, user_id)
    if not user:
        return jsonify(error="unknown_user"), 404
    if not user.mfa_reset_requested:
        return jsonify(error="no_pending_request"), 409

    user.totp_secret = None
    user.totp_enabled = False
    user.mfa_reset_requested = False
    # Force the user back through onboarding so a new TOTP secret is issued.
    user.is_setup = False
    db.session.commit()
    return jsonify(ok=True, user_id=user.id)


@admin_bp.post("/mfa-requests/<int:user_id>/decline")
@require_role("Admin")
def decline_mfa_reset(user_id: int):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify(error="unknown_user"), 404
    user.mfa_reset_requested = False
    db.session.commit()
    return jsonify(ok=True, user_id=user.id)


# ── Account reset requests (admin-assisted) ───────────────────────────────────
@admin_bp.get("/account-reset-requests")
@require_role("Admin")
def list_account_reset_requests():
    pending = AccountResetRequest.query.filter_by(status="pending").order_by(AccountResetRequest.created_at.asc()).all()
    return jsonify(requests=[
        {
            "id": r.id,
            "user_id": r.user_id,
            "username": r.user.username if r.user else None,
            "department": r.user.department.name if (r.user and r.user.department) else None,
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in pending
        if r.user is not None
    ])


def _audit(event: str, user: User | None, meta: dict | None = None) -> None:
    entry = AuditLog(
        event=event,
        user_id=user.id if user else None,
        username=user.username if user else None,
        ip=request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote_addr,
        meta_json=json.dumps(meta or {}),
    )
    db.session.add(entry)


def _reset_account_controlled(user: User) -> None:
    """Controlled account reset:
    - Keep identity fields (username, department, role).
    - Reset auth material + recovery factors + is_setup.
    - Option A (typical ZK): clear personal vault records.
    """
    # Clear personal/private data (Option A).
    EncryptedRecord.query.filter_by(user_id=user.id, record_scope="private").delete(synchronize_session=False)
    UserFavoriteRecord.query.filter_by(user_id=user.id).delete(synchronize_session=False)
    personal_vault = Vault.query.filter_by(type="Personal", owner_user_id=user.id).first()
    if personal_vault:
        EncryptedRecord.query.filter_by(vault_id=personal_vault.id, user_id=user.id).delete(synchronize_session=False)
        db.session.delete(personal_vault)

    # Reset auth state.
    user.auth_hash = None
    user.public_key = None
    user.totp_secret = None
    user.totp_enabled = False
    user.mfa_reset_requested = False
    user.is_setup = False
    user.recovery_failures = 0
    user.recovery_locked_until = None


@admin_bp.post("/account-reset-requests/<int:request_id>/approve")
@require_role("Admin")
@require_recent_mfa(max_age_seconds=300)
def approve_account_reset(request_id: int):
    req = db.session.get(AccountResetRequest, request_id)
    if not req:
        return jsonify(error="unknown_request"), 404
    if req.status != "pending":
        return jsonify(error="not_pending"), 409
    if not req.user:
        return jsonify(error="unknown_user"), 404

    user = req.user
    _reset_account_controlled(user)
    req.status = "approved"
    req.reviewed_at = datetime.now(timezone.utc)
    req.reviewed_by_user_id = g.current_user.id if g.current_user else None
    _audit("admin_account_reset_approved", user, meta={"request_id": req.id})
    db.session.commit()
    return jsonify(ok=True, request_id=req.id, user_id=user.id)


@admin_bp.post("/account-reset-requests/<int:request_id>/decline")
@require_role("Admin")
def decline_account_reset(request_id: int):
    req = db.session.get(AccountResetRequest, request_id)
    if not req:
        return jsonify(error="unknown_request"), 404
    if req.status != "pending":
        return jsonify(error="not_pending"), 409
    user = req.user
    req.status = "declined"
    req.reviewed_at = datetime.now(timezone.utc)
    req.reviewed_by_user_id = g.current_user.id if g.current_user else None
    _audit("admin_account_reset_declined", user, meta={"request_id": req.id})
    db.session.commit()
    return jsonify(ok=True, request_id=req.id)


# ── Bulk initialization ──────────────────────────────────────────────────────
@admin_bp.post("/bulk-init")
@require_role("Admin")
def bulk_init():
    """Bulk-create users and departments from parsed CSV rows.

    Expected JSON body:
      {
        "auth_key": "<admin's browser-derived AuthKey (base64)>",
        "rows": [
          {"username": "j.doe", "department": "IT_Department"},
          ...
        ]
      }

    The admin's auth_key is verified server-side to authorise the action.
    Missing departments are auto-created. Duplicate usernames are skipped
    with an error entry in the results.
    """
    data = request.get_json(silent=True) or {}
    auth_key = (data.get("auth_key") or "").strip()
    rows = data.get("rows")

    if not auth_key:
        return jsonify(error="auth_key_required"), 400
    if not rows or not isinstance(rows, list):
        return jsonify(error="no_rows"), 400
    if len(rows) > 500:
        return jsonify(error="too_many_rows"), 400

    # Verify the admin's password (auth_key) against their stored hash.
    admin_user: User = g.current_user
    if not admin_user.auth_hash:
        return jsonify(error="admin_auth_not_configured"), 403
    if not verify_auth_key(auth_key, admin_user.auth_hash):
        return jsonify(error="invalid_password"), 403

    _audit("admin_bulk_init_started", admin_user, meta={"row_count": len(rows)})

    user_role = Role.query.filter_by(name="User").first()
    if not user_role:
        user_role = Role(name="User")
        db.session.add(user_role)
        db.session.flush()

    results = []
    created_count = 0
    error_count = 0
    departments_created = []

    for idx, row in enumerate(rows):
        username = (row.get("username") or "").strip()
        dept_name = (row.get("department") or "").strip()
        row_num = idx + 1

        if not username:
            results.append({"row": row_num, "username": "", "status": "error", "reason": "Missing username"})
            error_count += 1
            continue

        if not dept_name:
            results.append({"row": row_num, "username": username, "status": "error", "reason": "Missing department"})
            error_count += 1
            continue

        # Check for duplicate username.
        if User.query.filter_by(username=username).first():
            results.append({"row": row_num, "username": username, "status": "error", "reason": "Username already exists"})
            error_count += 1
            continue

        # Get or create department.
        dept = Department.query.filter_by(name=dept_name).first()
        if not dept:
            dept = Department(name=dept_name)
            db.session.add(dept)
            db.session.flush()
            departments_created.append(dept_name)

        # Create user.
        user = User(
            username=username,
            department_id=dept.id,
            role_id=user_role.id,
            is_setup=False,
            totp_enabled=False,
        )
        db.session.add(user)
        created_count += 1
        results.append({"row": row_num, "username": username, "status": "created", "department": dept_name})

    db.session.commit()

    _audit("admin_bulk_init_completed", admin_user, meta={
        "created": created_count,
        "errors": error_count,
        "departments_created": departments_created,
    })

    return jsonify(
        ok=True,
        created=created_count,
        errors=error_count,
        departments_created=departments_created,
        results=results,
    )
