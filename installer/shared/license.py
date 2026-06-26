"""Signed offline license validation (RS256 JWT)."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization

_DEFAULT_PUBLIC_KEY = Path(__file__).resolve().parents[2] / "config" / "license-public.pem"
_DEFAULT_PRIVATE_KEY = Path(__file__).resolve().parents[2] / "config" / "license-private.pem"
TRIAL_DAYS = 90


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


def _private_key_path() -> Path:
    env = os.getenv("LICENSE_PRIVATE_KEY_PATH")
    if env:
        return Path(env)
    deploy_root = os.getenv("ETL_DEPLOYMENT_ROOT")
    if deploy_root:
        candidate = Path(deploy_root) / "config" / "license-private.pem"
        if candidate.is_file():
            return candidate
    return _DEFAULT_PRIVATE_KEY


def _load_private_key():
    path = _private_key_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"License private key not found: {path}. "
            "Run scripts/generate-license-keys.py on the host first."
        )
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def issue_trial_license(*, customer_id: str | None = None, days: int = TRIAL_DAYS) -> str:
    """Issue a signed trial license JWT (self-host / PoC installs)."""
    private_key = _load_private_key()
    now = datetime.now(timezone.utc)
    sub = customer_id or f"trial-{uuid.uuid4().hex[:12]}"
    claims = {
        "sub": sub,
        "edition": "trial",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=days)).timestamp()),
        "max_workspaces": 3,
    }
    return jwt.encode(claims, private_key, algorithm="RS256")


def resolve_license_key(key: str | None) -> str:
    """Return a valid license key, issuing a trial when none was provided."""
    key = (key or "").strip()
    if key:
        validate_license_key(key)
        return key
    trial = issue_trial_license()
    validate_license_key(trial)
    return trial


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
