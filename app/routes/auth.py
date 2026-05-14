"""Authentication routes: login probe, First Time Login, two-step login."""

from __future__ import annotations

import base64
import io
import json
import os
import secrets
import time
from datetime import datetime, timezone, timedelta

import pyotp
import qrcode
from flask import Blueprint, g, jsonify, make_response, request

from ..auth_utils import (
    hash_auth_key,
    issue_token,
    require_scope,
    verify_auth_key,
)
from ..extensions import db
from ..models import AuditLog, User

auth_bp = Blueprint("auth", __name__)

TOTP_ISSUER = "A2Z Vault"
PENDING_TTL = 300      # 5 minutes to complete TOTP after AuthHash accepted
SESSION_TTL = 3600     # 1 hour session

RECOVERY_LOCK_THRESHOLD = int(os.environ.get("RECOVERY_LOCK_THRESHOLD", "5"))
RECOVERY_LOCK_SECONDS = int(os.environ.get("RECOVERY_LOCK_SECONDS", "300"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") == "1"
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "Strict")
SESSION_COOKIE_NAME = "a2z_session"
CSRF_COOKIE_NAME = "a2z_csrf"
_RATE_BUCKETS: dict[str, list[float]] = {}


def _client_ip() -> str | None:
    return request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote_addr


def _audit(event: str, user: User | None, meta: dict | None = None) -> None:
    entry = AuditLog(
        event=event,
        user_id=user.id if user else None,
        username=user.username if user else None,
        ip=_client_ip(),
        meta_json=json.dumps(meta or {}),
    )
    db.session.add(entry)


def _session_payload(user: User) -> dict:
    return {
        "expires_in": SESSION_TTL,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.name if user.role else None,
            "department_id": user.department_id,
            "department": user.department.name if user.department else None,
        },
    }


def _set_session_cookie(response, user: User, mfa_verified_at: int | None = None) -> None:
    claims = {"mfa_verified_at": mfa_verified_at} if mfa_verified_at else None
    session = issue_token(user, scope="session", ttl_seconds=SESSION_TTL, extra_claims=claims)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session,
        max_age=SESSION_TTL,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _set_csrf_cookie(response) -> None:
    csrf_value = request.cookies.get(CSRF_COOKIE_NAME) or secrets.token_urlsafe(32)
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_value,
        max_age=SESSION_TTL,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )


def _session_response(user: User, mfa_verified_at: int | None = None):
    response = make_response(jsonify(_session_payload(user)))
    _set_session_cookie(response, user, mfa_verified_at=mfa_verified_at)
    _set_csrf_cookie(response)
    return response


def _check_rate_limit(bucket: str, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    now = time.time()
    combined = f"{bucket}:{key}"
    samples = _RATE_BUCKETS.setdefault(combined, [])
    cutoff = now - window_seconds
    samples[:] = [sample for sample in samples if sample >= cutoff]
    if len(samples) >= limit:
        retry_after = max(1, int(window_seconds - (now - samples[0])))
        return True, retry_after
    samples.append(now)
    return False, 0


def _rate_limit_response(retry_after: int):
    response = jsonify(error="rate_limited", retry_after=retry_after)
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


# ── 1. Login probe ───────────────────────────────────────────────────────────
@auth_bp.post("/probe")
def probe():
    """Given a username, return whether the account still needs FTL setup.

    The UI uses this to branch between the "Create Master Password" flow and
    the standard two-step login flow.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify(error="username_required"), 400
    ip = _client_ip() or "unknown"
    blocked, retry_after = _check_rate_limit("auth_probe_ip", ip, limit=30, window_seconds=60)
    if blocked:
        return _rate_limit_response(retry_after)

    user = User.query.filter_by(username=username).first()
    if not user:
        # Don't leak existence: always return a plausible shape.
        return jsonify(exists=False, is_setup=True)

    return jsonify(exists=True, is_setup=user.is_setup)


# ── 2. First Time Login (FTL) ────────────────────────────────────────────────
@auth_bp.post("/ftl")
def first_time_login():
    """Accept a new AuthHash + public_key from a user whose `is_setup == False`.

    Stores the hashed AuthKey + RSA public key and marks the user as set up.
    TOTP is optional and can be provisioned after onboarding.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    auth_hash_b64 = data.get("auth_hash")
    public_key = data.get("public_key")

    if not (username and auth_hash_b64 and public_key):
        return jsonify(error="missing_fields"), 400

    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify(error="unknown_user"), 404
    if user.is_setup:
        return jsonify(error="already_setup"), 409

    user.auth_hash = hash_auth_key(auth_hash_b64)
    user.public_key = public_key
    user.totp_secret = None
    user.totp_enabled = False
    user.is_setup = True
    user.mfa_reset_requested = False
    db.session.commit()

    _audit("ftl_complete", user)
    return jsonify(provisioning_uri=None, qr_png_base64=None, totp_recommended=True)


# ── 3. Two-step login: step 1 (AuthHash) ─────────────────────────────────────
@auth_bp.post("/login")
def login_step1():
    """Verify the AuthHash. On success, return a short-lived `pending_totp`
    JWT. The client must present it in step 2.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    auth_hash_b64 = data.get("auth_hash")

    if not (username and auth_hash_b64):
        return jsonify(error="missing_fields"), 400
    ip = _client_ip() or "unknown"
    blocked, retry_after = _check_rate_limit("auth_login_ip", ip, limit=30, window_seconds=60)
    if blocked:
        return _rate_limit_response(retry_after)
    blocked, retry_after = _check_rate_limit(
        "auth_login_username",
        username.lower(),
        limit=5,
        window_seconds=60,
    )
    if blocked:
        return _rate_limit_response(retry_after)

    user = User.query.filter_by(username=username).first()
    if not user or not user.is_setup or not user.auth_hash:
        return jsonify(error="invalid_credentials"), 401
    if not verify_auth_key(auth_hash_b64, user.auth_hash):
        return jsonify(error="invalid_credentials"), 401

    if not user.totp_enabled or not user.totp_secret:
        return _session_response(user, mfa_verified_at=int(time.time()))

    token = issue_token(user, scope="pending_totp", ttl_seconds=PENDING_TTL)
    return jsonify(
        pending_token=token,
        expires_in=PENDING_TTL,
        allow_mfa_skip=False,
    )


# ── 4. Two-step login: step 2 (TOTP) ─────────────────────────────────────────
@auth_bp.post("/totp")
@require_scope("pending_totp")
def login_step2():
    """Validate a TOTP code against the user identified by the `pending_totp`
    JWT and, on success, issue a full `session` JWT.
    """
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        return jsonify(error="missing_code"), 400

    user: User = g.current_user
    ip = _client_ip() or "unknown"
    blocked, retry_after = _check_rate_limit("auth_totp_ip", ip, limit=30, window_seconds=60)
    if blocked:
        return _rate_limit_response(retry_after)
    blocked, retry_after = _check_rate_limit(
        "auth_totp_user",
        f"{user.id}:{ip}",
        limit=10,
        window_seconds=60,
    )
    if blocked:
        return _rate_limit_response(retry_after)
    if not user.totp_enabled or not user.totp_secret:
        return jsonify(error="mfa_not_provisioned"), 409

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        return jsonify(error="invalid_code"), 401

    _audit("login_totp_verified", user)
    return _session_response(user, mfa_verified_at=int(time.time()))


@auth_bp.post("/totp/provision/start")
@require_scope("session")
def totp_provision_start():
    user: User = g.current_user
    if user.totp_enabled and user.totp_secret:
        return jsonify(error="already_enabled"), 409

    if not user.totp_secret:
        user.totp_secret = pyotp.random_base32()
        db.session.commit()

    provisioning_uri = pyotp.totp.TOTP(user.totp_secret).provisioning_uri(
        name=user.username,
        issuer_name=TOTP_ISSUER,
    )
    buf = io.BytesIO()
    qrcode.make(provisioning_uri).save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    _audit("totp_provision_start", user)
    return jsonify(provisioning_uri=provisioning_uri, qr_png_base64=qr_b64)


@auth_bp.post("/totp/provision/confirm")
@require_scope("session")
def totp_provision_confirm():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        return jsonify(error="missing_code"), 400
    user: User = g.current_user
    if not user.totp_secret:
        return jsonify(error="totp_not_started"), 409

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        return jsonify(error="invalid_code"), 401

    user.totp_enabled = True
    db.session.commit()
    _audit("totp_provision_confirm", user)
    return jsonify(ok=True, totp_enabled=True)


@auth_bp.post("/totp/disable")
@require_scope("session")
def totp_disable():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        return jsonify(error="missing_code"), 400
    user: User = g.current_user
    if not user.totp_enabled or not user.totp_secret:
        return jsonify(error="mfa_not_provisioned"), 409

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        return jsonify(error="invalid_code"), 401

    user.totp_enabled = False
    user.totp_secret = None
    db.session.commit()
    _audit("totp_disabled", user)
    return jsonify(ok=True, totp_enabled=False)





# ── 6. Recovery Path 1: token-based reset ─────────────────────────────────────
@auth_bp.post("/recovery/token-reset")
def token_based_master_reset():
    """Path 1 — user has current TOTP token, but lost master password.

    Input: username + current TOTP code + new auth_hash + new public_key
    If valid: replace auth material and keep same user record.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    totp_code = (data.get("totp_code") or "").strip()
    auth_hash_b64 = data.get("auth_hash")
    public_key = data.get("public_key")
    if not (username and totp_code and auth_hash_b64 and public_key):
        return jsonify(error="missing_fields"), 400
    ip = _client_ip() or "unknown"
    blocked, retry_after = _check_rate_limit(
        "recovery_token_reset_username",
        username.lower(),
        limit=3,
        window_seconds=3600,
    )
    if blocked:
        return _rate_limit_response(retry_after)
    blocked, retry_after = _check_rate_limit(
        "recovery_token_reset_ip",
        ip,
        limit=10,
        window_seconds=3600,
    )
    if blocked:
        return _rate_limit_response(retry_after)

    user = User.query.filter_by(username=username).first()
    if not user or not user.is_setup:
        return jsonify(error="invalid_credentials"), 401

    now = datetime.now(timezone.utc)
    if user.recovery_locked_until and user.recovery_locked_until.replace(tzinfo=timezone.utc) > now:
        _audit("recovery_token_reset_locked", user)
        return jsonify(error="locked"), 429

    if not user.totp_enabled or not user.totp_secret:
        return jsonify(error="mfa_not_provisioned"), 409

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(totp_code, valid_window=0):
        user.recovery_failures = int(user.recovery_failures or 0) + 1
        if user.recovery_failures >= RECOVERY_LOCK_THRESHOLD:
            user.recovery_locked_until = now + timedelta(seconds=RECOVERY_LOCK_SECONDS)
        db.session.commit()
        _audit("recovery_token_reset_invalid_totp", user, meta={"failures": user.recovery_failures})
        return jsonify(error="invalid_code"), 401

    user.recovery_failures = 0
    user.recovery_locked_until = None
    user.auth_hash = hash_auth_key(auth_hash_b64)
    user.public_key = public_key
    user.is_setup = True
    db.session.commit()

    _audit("recovery_token_reset_success", user)
    return _session_response(user, mfa_verified_at=int(time.time()))


@auth_bp.post("/admin-step-up")
@require_scope("session")
def admin_step_up():
    user: User = g.current_user
    if not user.role or user.role.name != "Admin":
        return jsonify(error="forbidden"), 403
    if not user.totp_enabled or not user.totp_secret:
        return jsonify(error="mfa_not_provisioned"), 409

    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    if not code:
        return jsonify(error="missing_code"), 400

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, valid_window=1):
        _audit("admin_step_up_invalid_totp", user)
        return jsonify(error="invalid_code"), 401

    _audit("admin_step_up_success", user)
    return _session_response(user, mfa_verified_at=int(time.time()))


@auth_bp.post("/logout")
def logout():
    response = make_response(jsonify(ok=True))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        "",
        expires=0,
        max_age=0,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return response


# ── 5. Who am I ──────────────────────────────────────────────────────────────
@auth_bp.get("/me")
@require_scope("session")
def whoami():
    user: User = g.current_user
    return jsonify(
        id=user.id,
        username=user.username,
        role=user.role.name if user.role else None,
        department_id=user.department_id,
        department=user.department.name if user.department else None,
        is_setup=user.is_setup,
        totp_enabled=user.totp_enabled,
    )
