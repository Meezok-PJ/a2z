"""Template routes for minimal frontend screens."""

from __future__ import annotations

from pathlib import Path

from flask import Blueprint, abort, render_template, send_file

web_bp = Blueprint("web", __name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOGO_PATH = PROJECT_ROOT / "a2z_logo-removebg-preview.png"


@web_bp.get("/")
def landing_page():
    return render_template("landing.html")


@web_bp.get("/login")
def login_page():
    return render_template("login.html")


@web_bp.get("/admin")
def admin_page():
    return render_template("admin.html")


@web_bp.get("/vault")
def vault_page():
    return render_template("vault.html")


@web_bp.get("/security")
def security_page():
    return render_template("security.html")


@web_bp.get("/presentation")
def presentation_page():
    return render_template("presentation.html")


@web_bp.get("/branding/logo")
def branding_logo():
    if not LOGO_PATH.exists():
        abort(404)
    return send_file(LOGO_PATH, mimetype="image/png")
