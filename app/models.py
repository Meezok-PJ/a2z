"""SQLAlchemy models for A2Z."""

from .extensions import db
from datetime import datetime
import json


class Department(db.Model):
    __tablename__ = "departments"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)


class Role(db.Model):
    __tablename__ = "roles"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    auth_hash = db.Column(db.String(255), nullable=True)
    public_key = db.Column(db.Text, nullable=True)
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id"), nullable=True)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=True)
    totp_secret = db.Column(db.String(100), nullable=True)
    totp_enabled = db.Column(db.Boolean, default=False, nullable=False)
    is_setup = db.Column(db.Boolean, default=False, nullable=False)
    mfa_reset_requested = db.Column(db.Boolean, default=False, nullable=False)
    recovery_failures = db.Column(db.Integer, default=0, nullable=False)
    recovery_locked_until = db.Column(db.DateTime, nullable=True)

    department = db.relationship("Department", backref=db.backref("users", lazy=True))
    role = db.relationship("Role", backref=db.backref("users", lazy=True))


class Vault(db.Model):
    __tablename__ = "vaults"
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False)  # 'Personal' or 'Organizational'
    department_id = db.Column(db.Integer, db.ForeignKey("departments.id"), nullable=True)
    owner_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    department = db.relationship("Department", backref=db.backref("vaults", lazy=True))
    owner = db.relationship("User", backref=db.backref("vaults", lazy=True), foreign_keys=[owner_user_id])


class EncryptedRecord(db.Model):
    __tablename__ = "encrypted_records"
    id = db.Column(db.Integer, primary_key=True)
    vault_id = db.Column(db.Integer, db.ForeignKey("vaults.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    record_scope = db.Column(db.String(32), nullable=False, default="shared")
    service_name = db.Column(db.String(255), nullable=True)
    service_username = db.Column(db.String(255), nullable=True)
    service_url = db.Column(db.String(512), nullable=True)
    ciphertext_blob = db.Column(db.Text, nullable=False)
    iv_blob = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    vault = db.relationship(
        "Vault",
        backref=db.backref("records", lazy=True, cascade="all, delete-orphan"),
    )
    user = db.relationship("User", backref=db.backref("records", lazy=True))


class UserFavoriteRecord(db.Model):
    __tablename__ = "user_favorite_records"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    record_id = db.Column(db.Integer, db.ForeignKey("encrypted_records.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("user_id", "record_id", name="uq_user_favorite_record"),
    )

    user = db.relationship("User", backref=db.backref("favorite_records", lazy=True))
    record = db.relationship("EncryptedRecord", backref=db.backref("favorite_links", lazy=True, cascade="all, delete-orphan"))


class AccountResetRequest(db.Model):
    __tablename__ = "account_reset_requests"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    reason = db.Column(db.String(256), nullable=True)
    metadata_json = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(32), nullable=False, default="pending")  # pending|approved|declined
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    user = db.relationship("User", foreign_keys=[user_id], backref=db.backref("account_reset_requests", lazy=True))
    reviewed_by = db.relationship("User", foreign_keys=[reviewed_by_user_id], lazy=True)

    def set_metadata(self, obj) -> None:
        self.metadata_json = json.dumps(obj or {})


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.Integer, primary_key=True)
    event = db.Column(db.String(64), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    username = db.Column(db.String(100), nullable=True, index=True)
    ip = db.Column(db.String(64), nullable=True)
    meta_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    user = db.relationship("User", foreign_keys=[user_id], lazy=True)
