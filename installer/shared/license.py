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
from cryptography.hazmat.primitives.asymmetric import rsa

TRIAL_DAYS = 90


def _state_dir() -> Path:
    return Path(os.getenv("INSTALLER_STATE_DIR", "/opt/etl-deployment-state"))


def _deployment_config_dir() -> Path:
    root = os.getenv("ETL_DEPLOYMENT_ROOT")
    if root:
        return Path(root) / "config"
    return Path(__file__).resolve().parents[2] / "config"


def _generate_keypair(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    (directory / "license-private.pem").write_bytes(priv)
    (directory / "license-public.pem").write_bytes(pub)
    try:
        os.chmod(directory / "license-private.pem", 0o600)
    except OSError:
        pass


def _license_key_directory() -> Path:
    """Return directory containing a usable private+public license keypair."""
    config_dir = _deployment_config_dir()
    if (config_dir / "license-private.pem").is_file() and (config_dir / "license-public.pem").is_file():
        return config_dir

    state_dir = _state_dir()
    if (state_dir / "license-private.pem").is_file() and (state_dir / "license-public.pem").is_file():
        return state_dir

    try:
        _generate_keypair(state_dir)
        return state_dir
    except OSError as exc:
        raise FileNotFoundError(
            "Could not create license keys for free trial. "
            "On the server run: python3 scripts/generate-license-keys.py --out-dir config"
        ) from exc


@dataclass
class LicenseInfo:
    customer_id: str
    edition: str
    expires_at: datetime | None
    max_workspaces: int | None
    raw_claims: dict[str, Any]


def _public_key_path() -> Path:
    env_pub = os.getenv("LICENSE_PUBLIC_KEY_PATH")
    env_priv = os.getenv("LICENSE_PRIVATE_KEY_PATH")
    if (
        env_pub
        and env_priv
        and Path(env_pub).is_file()
        and Path(env_priv).is_file()
    ):
        return Path(env_pub)
    return _license_key_directory() / "license-public.pem"


def _private_key_path() -> Path:
    env_pub = os.getenv("LICENSE_PUBLIC_KEY_PATH")
    env_priv = os.getenv("LICENSE_PRIVATE_KEY_PATH")
    if (
        env_pub
        and env_priv
        and Path(env_pub).is_file()
        and Path(env_priv).is_file()
    ):
        return Path(env_priv)
    return _license_key_directory() / "license-private.pem"


def _load_private_key():
    path = _private_key_path()
    if not path.is_file():
        _license_key_directory()
        path = _private_key_path()
    if not path.is_file():
        raise FileNotFoundError(
            f"License private key not found: {path}. "
            "On the server run: python3 scripts/generate-license-keys.py --out-dir config"
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
        _license_key_directory()
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
