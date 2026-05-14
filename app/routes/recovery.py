"""Account recovery routes.

Path 2 — user lost master password and 2FA token:
- Input: username + short reason/metadata
- Output: create an admin review request (pending)
"""

from __future__ import annotations

import json
import time

from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import AccountResetRequest, AuditLog, User

recovery_bp = Blueprint("recovery", __name__)
_RATE_BUCKETS: dict[str, list[float]] = {}


def _client_ip() -> str | None:
    return request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote_addr


def _audit(event: str, user: User | None, meta_json: str | None = None) -> None:
    entry = AuditLog(
        event=event,
        user_id=user.id if user else None,
        username=user.username if user else None,
        ip=_client_ip(),
        meta_json=meta_json or json.dumps({}),
    )
    db.session.add(entry)


def _check_rate_limit(bucket: str, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    now = time.time()
    composite = f"{bucket}:{key}"
    samples = _RATE_BUCKETS.setdefault(composite, [])
    cutoff = now - window_seconds
    samples[:] = [sample for sample in samples if sample >= cutoff]
    if len(samples) >= limit:
        retry_after = max(1, int(window_seconds - (now - samples[0])))
        return True, retry_after
    samples.append(now)
    return False, 0


@recovery_bp.post("/admin-reset-request")
def request_admin_reset():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    reason = (data.get("reason") or "").strip() or None

    if not username:
        return jsonify(error="username_required"), 400
    ip = _client_ip() or "unknown"
    limited, retry_after = _check_rate_limit("admin_reset_username", username.lower(), 3, 3600)
    if limited:
        response = jsonify(error="rate_limited", retry_after=retry_after)
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response
    limited, retry_after = _check_rate_limit("admin_reset_ip", ip, 10, 3600)
    if limited:
        response = jsonify(error="rate_limited", retry_after=retry_after)
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response

    user = User.query.filter_by(username=username).first()
    # Do not leak user existence. Always return ok.
    if not user:
        _audit("recovery_admin_reset_request_unknown_user", None)
        db.session.commit()
        return jsonify(ok=True)

    existing = AccountResetRequest.query.filter_by(user_id=user.id, status="pending").first()
    if existing:
        _audit("recovery_admin_reset_request_duplicate", user)
        db.session.commit()
        return jsonify(ok=True, request_id=existing.id)

    req = AccountResetRequest(user_id=user.id, reason=reason, status="pending")
    req.set_metadata({"user_agent": request.headers.get("User-Agent", ""), "ip": _client_ip()})
    db.session.add(req)
    _audit("recovery_admin_reset_request_created", user)
    db.session.commit()
    return jsonify(ok=True, request_id=req.id)

