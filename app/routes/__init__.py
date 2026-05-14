"""Blueprint registration helper."""

from flask import Flask

from .admin import admin_bp
from .auth import auth_bp
from .mfa import mfa_bp
from .recovery import recovery_bp
from .vault import vault_bp
from .web import web_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(web_bp)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(mfa_bp, url_prefix="/api/mfa")
    app.register_blueprint(recovery_bp, url_prefix="/api/recovery")
    app.register_blueprint(vault_bp, url_prefix="/api/vault")
