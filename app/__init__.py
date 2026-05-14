"""A2Z Organizational Prototype – Flask Application Factory."""

import os
import secrets

from flask import Flask, g, jsonify, request

from .auth_utils import ensure_admin_user
from .bootstrap_data import ensure_reference_data
from .extensions import db
from .schema_maintenance import ensure_vault_schema


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
    )

    # ── Database configuration ──────────────────────────────────────────
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
        "DATABASE_URL",
        "postgresql://a2z:a2z_secret@db:5432/a2z_vault",
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key")
    app.config["COOKIE_SECURE"] = os.environ.get("COOKIE_SECURE", "1") == "1"
    app.config["COOKIE_SAMESITE"] = os.environ.get("COOKIE_SAMESITE", "Strict")

    # ── Initialize extensions ───────────────────────────────────────────
    db.init_app(app)

    # Import models so SQLAlchemy registers them before blueprints are wired.
    with app.app_context():
        from . import models  # noqa: F401

    # ── Blueprints ──────────────────────────────────────────────────────
    from .routes import register_blueprints

    register_blueprints(app)

    # ── Auto-seed Admin on first boot (idempotent) ──────────────────────
    if os.environ.get("AUTO_SEED_ADMIN", "1") == "1":
        with app.app_context():
            try:
                db.create_all()
                ensure_vault_schema()
                ensure_reference_data()
                ensure_admin_user()
            except Exception as exc:  # pragma: no cover - startup logging
                app.logger.warning("Admin auto-seed deferred: %s", exc)

    # ── Healthcheck ─────────────────────────────────────────────────────
    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    @app.before_request
    def issue_csp_nonce():
        g.csp_nonce = secrets.token_urlsafe(16)

    @app.before_request
    def enforce_csrf_for_api_mutations():
        if not request.path.startswith("/api/"):
            return None
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return None
        csrf_cookie = request.cookies.get("a2z_csrf", "")
        csrf_header = request.headers.get("X-CSRF-Token", "")
        if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
            return jsonify(error="csrf_validation_failed"), 403
        return None

    @app.after_request
    def ensure_csrf_cookie(response):
        csp_nonce = getattr(g, "csp_nonce", "")
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; "
            "base-uri 'none'; "
            "object-src 'none'; "
            "frame-ancestors 'none'; "
            "form-action 'self'; "
            "img-src 'self' data:; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "connect-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com 'nonce-"
            + csp_nonce
            + "' 'wasm-unsafe-eval'; "
            "upgrade-insecure-requests"
        )
        if request.cookies.get("a2z_csrf"):
            return response
        response.set_cookie(
            "a2z_csrf",
            secrets.token_urlsafe(32),
            max_age=3600,
            httponly=False,
            secure=app.config["COOKIE_SECURE"],
            samesite=app.config["COOKIE_SAMESITE"],
            path="/",
        )
        return response

    @app.context_processor
    def inject_security_context():
        return {"csp_nonce": getattr(g, "csp_nonce", "")}

    return app
