"""Authentication helpers: JWT issuance/verification and RBAC decorator.

The server is strictly zero-knowledge. It never sees the Master Password or
any plaintext vault data. The `auth_hash` stored on the User row is the
deterministic `AuthKey` derived in the browser (Phase 2 crypto engine) and is
itself re-hashed on the server using a slow KDF before comparison.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from functools import wraps
from typing import Any, Callable

import jwt
from flask import current_app, g, jsonify, request

from .extensions import db
from .models import User, Role


# ── Server-side auth_hash hashing ────────────────────────────────────────────
# We layer PBKDF2-HMAC-SHA256 on top of the client-derived AuthKey so that a
# database leak doesn't trivially grant login ability.
AUTH_HASH_ITERATIONS = 200_000
AUTH_HASH_SALT_BYTES = 16


def hash_auth_key(auth_key_b64: str, salt: bytes | None = None) -> str:
    """Return a `salt$hash` string for storage. `auth_key_b64` is the Base64
    AuthKey supplied by the browser."""
    if salt is None:
        salt = secrets.token_bytes(AUTH_HASH_SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        auth_key_b64.encode("utf-8"),
        salt,
        AUTH_HASH_ITERATIONS,
    )
    return f"{salt.hex()}${derived.hex()}"


def verify_auth_key(auth_key_b64: str, stored: str) -> bool:
    """Constant-time verification of an incoming AuthKey against storage."""
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, AttributeError):
        return False
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        auth_key_b64.encode("utf-8"),
        salt,
        AUTH_HASH_ITERATIONS,
    )
    return hmac.compare_digest(derived.hex(), hash_hex)


# ── JWT helpers ──────────────────────────────────────────────────────────────
def _secret() -> str:
    return current_app.config["SECRET_KEY"]


def issue_token(
    user: User,
    scope: str,
    ttl_seconds: int,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Issue a JWT with a scope string (`pending_totp` or `session`)."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.name if user.role else None,
        "scope": scope,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, _secret(), algorithm="HS256")


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def _extract_token() -> str | None:
    """Extract a session token, preferring secure cookie transport."""
    cookie_token = request.cookies.get("a2z_session")
    if cookie_token:
        return cookie_token

    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip()
    return None


# ── Decorators ───────────────────────────────────────────────────────────────
def require_scope(scope: str) -> Callable:
    """Require a valid JWT with the exact scope (e.g. `session`)."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any):
            token = _extract_token()
            if not token:
                return jsonify(error="missing_token"), 401
            payload = decode_token(token)
            if not payload or payload.get("scope") != scope:
                return jsonify(error="invalid_token"), 401
            user = db.session.get(User, payload["sub"])
            if not user:
                return jsonify(error="unknown_user"), 401
            g.current_user = user
            g.token_payload = payload
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def require_role(role_name: str) -> Callable:
    """Require an authenticated `session` token **and** a specific role."""

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        @require_scope("session")
        def wrapper(*args: Any, **kwargs: Any):
            user: User = g.current_user
            if not user.role or user.role.name != role_name:
                return jsonify(error="forbidden"), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def require_recent_mfa(max_age_seconds: int = 300) -> Callable:
    """Require recent MFA step-up on an authenticated session token.

    If the user does not have TOTP configured, this check is skipped to preserve
    local-development behavior.
    """

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any):
            user: User | None = getattr(g, "current_user", None)
            if not user:
                return jsonify(error="missing_user_context"), 401
            if not user.totp_enabled:
                return fn(*args, **kwargs)

            payload: dict[str, Any] = getattr(g, "token_payload", {})
            verified_at = payload.get("mfa_verified_at")
            if not isinstance(verified_at, int):
                return jsonify(error="step_up_required"), 403

            now = int(time.time())
            if now - verified_at > max_age_seconds:
                return jsonify(error="step_up_required"), 403
            return fn(*args, **kwargs)

        return wrapper

    return decorator


# ── Admin seeding ────────────────────────────────────────────────────────────
def ensure_admin_user() -> None:
    """Seed the Admin user from environment variables if missing.

    Required env vars:
      - ADMIN_USERNAME
      - ADMIN_MASTER_PASSWORD_HASH  (the browser-derived AuthKey, Base64)
    """
    username = os.environ.get("ADMIN_USERNAME")
    auth_hash_b64 = os.environ.get("ADMIN_MASTER_PASSWORD_HASH")
    if not username or not auth_hash_b64:
        current_app.logger.warning(
            "Admin seeding skipped: ADMIN_USERNAME / ADMIN_MASTER_PASSWORD_HASH "
            "not set."
        )
        return

    admin_role = Role.query.filter_by(name="Admin").first()
    if not admin_role:
        admin_role = Role(name="Admin")
        db.session.add(admin_role)
        db.session.flush()


    existing = User.query.filter_by(username=username).first()
    if existing:
        existing.role_id = admin_role.id
        # Keep default credentials usable for local development launches.
        existing.auth_hash = hash_auth_key(auth_hash_b64)
        existing.is_setup = True
        db.session.commit()
        return

    admin = User(
        username=username,
        auth_hash=hash_auth_key(auth_hash_b64),
        role_id=admin_role.id,
        department_id=None,
        is_setup=True,
        totp_enabled=False,
    )
    db.session.add(admin)
    db.session.commit()
    current_app.logger.info("Seeded Admin user '%s'.", username)
