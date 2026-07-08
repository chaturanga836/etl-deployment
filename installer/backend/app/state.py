"""Shared installer state helpers used across backend modules."""

from __future__ import annotations

import os
from pathlib import Path

DEPLOYMENT_ROOT = Path(os.getenv("ETL_DEPLOYMENT_ROOT", "/opt/etl-deployment"))
STATE_DIR = Path(os.getenv("INSTALLER_STATE_DIR", "/opt/etl-deployment-state"))


def resolve_env_path() -> Path | None:
    """Match upgrade.sh / install.sh env file resolution."""
    if STATE_DIR.is_dir() and (STATE_DIR / ".env").is_file():
        return STATE_DIR / ".env"
    root_env = DEPLOYMENT_ROOT / ".env"
    if root_env.is_file():
        return root_env
    return None


def read_env_value(env_path: Path, key: str) -> str | None:
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip()
    return None
