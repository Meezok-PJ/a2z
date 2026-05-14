"""Vault read endpoints for dashboard views."""

from __future__ import annotations

import json

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func

from ..auth_utils import require_scope
from ..extensions import db
from ..models import EncryptedRecord, User, UserFavoriteRecord, Vault

vault_bp = Blueprint("vault", __name__)


def _serialize_record(record: EncryptedRecord, favorite_ids: set[int], include_ciphertext: bool = True) -> dict:
    payload = {
        "id": record.id,
        "vault_id": record.vault_id,
        "record_scope": record.record_scope or "shared",
        "owner_username": record.user.username if record.user else None,
        "service_name": record.service_name,
        "service_username": record.service_username,
        "service_url": record.service_url,
        "is_favorite": record.id in favorite_ids,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
    if include_ciphertext:
        wrapped_key = None
        try:
            blob_json = json.loads(record.ciphertext_blob)
            if isinstance(blob_json, dict):
                wrapped_key = (
                    blob_json.get("wrapped_key")
                    or blob_json.get("wrapped_vault_key")
                    or blob_json.get("wrappedKey")
                )
        except (TypeError, ValueError):
            wrapped_key = None
        payload["ciphertext_blob"] = record.ciphertext_blob
        payload["iv_blob"] = record.iv_blob
        payload["wrapped_key"] = wrapped_key
    return payload


def _shared_records_for_user(user: User) -> list[EncryptedRecord]:
    department = user.department
    if not department:
        return []
    org_vault_ids = [
        vault.id
        for vault in Vault.query.filter_by(
            type="Organizational",
            department_id=department.id,
        ).all()
    ]
    if not org_vault_ids:
        return []
    records = (
        EncryptedRecord.query.filter(
            EncryptedRecord.vault_id.in_(org_vault_ids),
        )
        .order_by(EncryptedRecord.created_at.desc())
        .all()
    )
    scoped_records = []
    for record in records:
        if (record.record_scope or "shared") == "shared":
            scoped_records.append(record)
    return scoped_records


def _private_vault_for_user(user: User) -> Vault:
    private_vault = Vault.query.filter_by(type="Personal", department_id=None, owner_user_id=user.id).first()
    if not private_vault:
        private_vault = (
            Vault.query.join(EncryptedRecord, EncryptedRecord.vault_id == Vault.id)
            .filter(
                Vault.type == "Personal",
                EncryptedRecord.user_id == user.id,
            )
            .order_by(Vault.id.asc())
            .first()
        )
    if private_vault:
        return private_vault
    private_vault = Vault(type="Personal", department_id=None, owner_user_id=user.id)
    db.session.add(private_vault)
    db.session.flush()
    return private_vault


def _private_records_for_user(user: User) -> list[EncryptedRecord]:
    private_vault = _private_vault_for_user(user)
    records = (
        EncryptedRecord.query.filter_by(vault_id=private_vault.id, user_id=user.id)
        .order_by(EncryptedRecord.created_at.desc())
        .all()
    )
    return [record for record in records if (record.record_scope or "private") == "private"]


def _favorite_ids_for_user(user: User) -> set[int]:
    links = UserFavoriteRecord.query.filter_by(user_id=user.id).all()
    return {link.record_id for link in links}


@vault_bp.get("/dashboard")
@require_scope("session")
def dashboard_payload():
    user: User = g.current_user
    department = user.department
    favorite_ids = _favorite_ids_for_user(user)
    shared_records = [_serialize_record(rec, favorite_ids, include_ciphertext=True) for rec in _shared_records_for_user(user)]
    private_records = [_serialize_record(rec, favorite_ids, include_ciphertext=True) for rec in _private_records_for_user(user)]

    return jsonify(
        username=user.username,
        department=department.name if department else None,
        shared_passwords=shared_records,
        private_passwords=private_records,
        wrapped_keys=[item.get("wrapped_key") for item in shared_records],
    )


@vault_bp.get("/shared")
@require_scope("session")
def list_shared_passwords():
    user: User = g.current_user
    department = user.department
    favorite_ids = _favorite_ids_for_user(user)
    shared = [_serialize_record(rec, favorite_ids, include_ciphertext=True) for rec in _shared_records_for_user(user)]
    return jsonify(
        username=user.username,
        department=department.name if department else None,
        ciphertext_blobs=shared,
        wrapped_keys=[item.get("wrapped_key") for item in shared],
        shared_passwords=shared,
    )


@vault_bp.post("/private-records")
@require_scope("session")
def create_private_record():
    user: User = g.current_user
    data = request.get_json(silent=True) or {}
    ciphertext_blob = data.get("ciphertext_blob")
    iv_blob = data.get("iv_blob")
    service_name = (data.get("service_name") or "").strip()
    service_username = (data.get("service_username") or "").strip()
    service_url = (data.get("service_url") or "").strip()
    if not ciphertext_blob or not iv_blob or not service_name or not service_username:
        return jsonify(error="missing_fields"), 400

    private_vault = _private_vault_for_user(user)
    existing_record = (
        EncryptedRecord.query.filter(
            EncryptedRecord.user_id == user.id,
            EncryptedRecord.record_scope == "private",
            func.lower(EncryptedRecord.service_name) == service_name.lower(),
            func.lower(EncryptedRecord.service_username) == service_username.lower(),
        )
        .order_by(EncryptedRecord.id.asc())
        .first()
    )

    if existing_record:
        existing_record.vault_id = private_vault.id
        existing_record.service_url = service_url or None
        existing_record.ciphertext_blob = ciphertext_blob
        existing_record.iv_blob = iv_blob
        db.session.commit()
        return jsonify(id=existing_record.id, updated_existing=True), 200

    record = EncryptedRecord(
        vault_id=private_vault.id,
        user_id=user.id,
        record_scope="private",
        service_name=service_name,
        service_username=service_username,
        service_url=service_url or None,
        ciphertext_blob=ciphertext_blob,
        iv_blob=iv_blob,
    )
    db.session.add(record)
    db.session.commit()
    return jsonify(id=record.id), 201


@vault_bp.post("/shared-records")
@require_scope("session")
def create_shared_record():
    """Allow a user to share a password with their department.

    The record is encrypted client-side with the department-derived key
    (same as admin-created shared records), so the server never sees
    plaintext.  Stored in the user's department Organizational vault.
    """
    user: User = g.current_user
    if not user.department_id or not user.department:
        return jsonify(error="no_department"), 400

    data = request.get_json(silent=True) or {}
    ciphertext_blob = data.get("ciphertext_blob")
    iv_blob = data.get("iv_blob")
    service_name = (data.get("service_name") or "").strip()
    service_username = (data.get("service_username") or "").strip()
    service_url = (data.get("service_url") or "").strip()
    if not ciphertext_blob or not iv_blob or not service_name or not service_username:
        return jsonify(error="missing_fields"), 400

    # Find or create the Organizational vault for the user's department.
    org_vault = Vault.query.filter_by(
        type="Organizational", department_id=user.department_id
    ).first()
    if not org_vault:
        org_vault = Vault(type="Organizational", department_id=user.department_id)
        db.session.add(org_vault)
        db.session.flush()

    record = EncryptedRecord(
        vault_id=org_vault.id,
        user_id=user.id,
        record_scope="shared",
        service_name=service_name,
        service_username=service_username,
        service_url=service_url or None,
        ciphertext_blob=ciphertext_blob,
        iv_blob=iv_blob,
    )
    db.session.add(record)
    db.session.commit()
    return jsonify(id=record.id), 201


@vault_bp.patch("/private-records/<int:record_id>")
@require_scope("session")
def update_private_record(record_id: int):
    user: User = g.current_user
    record = db.session.get(EncryptedRecord, record_id)
    if not record:
        return jsonify(error="unknown_record"), 404
    if record.user_id != user.id or record.record_scope != "private":
        return jsonify(error="forbidden_record"), 403

    data = request.get_json(silent=True) or {}
    ciphertext_blob = data.get("ciphertext_blob")
    iv_blob = data.get("iv_blob")
    service_name = (data.get("service_name") or "").strip()
    service_username = (data.get("service_username") or "").strip()
    service_url = (data.get("service_url") or "").strip()
    if not ciphertext_blob or not iv_blob or not service_name or not service_username:
        return jsonify(error="missing_fields"), 400

    record.ciphertext_blob = ciphertext_blob
    record.iv_blob = iv_blob
    record.service_name = service_name
    record.service_username = service_username
    record.service_url = service_url or None
    db.session.commit()
    return jsonify(ok=True, id=record.id)


@vault_bp.delete("/private-records/<int:record_id>")
@require_scope("session")
def delete_private_record(record_id: int):
    user: User = g.current_user
    record = db.session.get(EncryptedRecord, record_id)
    if not record:
        return jsonify(error="unknown_record"), 404
    if record.user_id != user.id or record.record_scope != "private":
        return jsonify(error="forbidden_record"), 403
    db.session.delete(record)
    db.session.commit()
    return jsonify(ok=True, id=record_id)


@vault_bp.post("/favorites/<int:record_id>")
@require_scope("session")
def set_favorite(record_id: int):
    user: User = g.current_user
    record = db.session.get(EncryptedRecord, record_id)
    if not record:
        return jsonify(error="unknown_record"), 404

    can_access = record.user_id == user.id
    if not can_access and user.department and record.vault and record.vault.type == "Organizational":
        can_access = record.vault.department_id == user.department.id
    if not can_access:
        return jsonify(error="forbidden_record"), 403

    link = UserFavoriteRecord.query.filter_by(user_id=user.id, record_id=record_id).first()
    if not link:
        db.session.add(UserFavoriteRecord(user_id=user.id, record_id=record_id))
    db.session.commit()
    return jsonify(ok=True, record_id=record_id, is_favorite=True)


@vault_bp.delete("/favorites/<int:record_id>")
@require_scope("session")
def unset_favorite(record_id: int):
    user: User = g.current_user
    link = UserFavoriteRecord.query.filter_by(user_id=user.id, record_id=record_id).first()
    if link:
        db.session.delete(link)
        db.session.commit()
    return jsonify(ok=True, record_id=record_id, is_favorite=False)
