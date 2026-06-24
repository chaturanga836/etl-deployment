"""Signed offline license validation (RS256 JWT)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jwt

_DEFAULT_PUBLIC_KEY = Path(__file__).resolve().parents[2] / "config" / "license-public.pem"


@dataclass
class LicenseInfo:
    customer_id: str
    edition: str
    expires_at: datetime | None
    max_workspaces: int | None
    raw_claims: dict[str, Any]


def _public_key_path() -> Path:
    env = os.getenv("LICENSE_PUBLIC_KEY_PATH")
    if env:
        return Path(env)
    return _DEFAULT_PUBLIC_KEY


def _load_public_key() -> str:
    path = _public_key_path()
    if not path.is_file():
        raise FileNotFoundError(f"License public key not found: {path}")
    return path.read_text(encoding="utf-8")


def validate_license_key(key: str) -> LicenseInfo:
    """Verify signature and expiry. Raises ValueError on failure."""
    key = (key or "").strip()
    if not key:
        raise ValueError("License key is required")

    public_key = _load_public_key()
    try:
        claims = jwt.decode(
            key,
            public_key,
            algorithms=["RS256"],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("License key has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError(f"Invalid license key: {exc}") from exc

    exp = claims.get("exp")
    expires_at = (
        datetime.fromtimestamp(int(exp), tz=timezone.utc) if exp is not None else None
    )
    max_ws = claims.get("max_workspaces")
    return LicenseInfo(
        customer_id=str(claims["sub"]),
        edition=str(claims.get("edition", "standard")),
        expires_at=expires_at,
        max_workspaces=int(max_ws) if max_ws is not None else None,
        raw_claims=claims,
    )


def license_required_in_env() -> bool:
    deploy_env = os.getenv("DTORCH_ENV") or os.getenv("ELT_ENV") or "development"
    return deploy_env == "production"


def assert_license_valid_if_required(key: str | None) -> LicenseInfo | None:
    if not license_required_in_env():
        if not key:
            return None
        return validate_license_key(key)
    if not key:
        raise ValueError("LICENSE_KEY is required in production")
    return validate_license_key(key)
