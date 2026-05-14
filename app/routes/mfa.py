"""Public MFA-reset request endpoint.

A user who has lost their authenticator proves identity by re-submitting
their AuthHash, then flips `mfa_reset_requested = true`. An Admin must
approve the flag through the admin endpoints before the TOTP secret is
cleared — the user themselves can never disable their own MFA.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..auth_utils import verify_auth_key
from ..extensions import db
from ..models import User

mfa_bp = Blueprint("mfa", __name__)


@mfa_bp.post("/request-reset")
def request_reset():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    auth_hash_b64 = data.get("auth_hash")
    if not (username and auth_hash_b64):
        return jsonify(error="missing_fields"), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.auth_hash:
        # Don't leak which half was wrong.
        return jsonify(error="invalid_credentials"), 401
    if not verify_auth_key(auth_hash_b64, user.auth_hash):
        return jsonify(error="invalid_credentials"), 401

    user.mfa_reset_requested = True
    db.session.commit()
    return jsonify(ok=True)
