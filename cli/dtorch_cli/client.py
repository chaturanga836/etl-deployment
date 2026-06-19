"""API client wrapper for CLI commands."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

_SDK_ROOT = Path(__file__).resolve().parents[2] / "sdk" / "python"
if _SDK_ROOT.is_dir() and str(_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(_SDK_ROOT))

from elt_sdk import EltClient, EltClientError


def get_access_token() -> Optional[str]:
    return os.environ.get("DTORCH_ACCESS_TOKEN") or os.environ.get("ELT_ACCESS_TOKEN")


def make_client(api_url: str) -> EltClient:
    return EltClient(api_url, get_access_token=get_access_token)


def fetch_applied_versions(client: EltClient, workspace_id: int, database_id: int) -> Dict[str, str]:
    payload = client.list_database_migrations(workspace_id, database_id)
    applied: Dict[str, str] = {}
    for row in payload.get("migrations", []):
        version = row.get("version")
        if version:
            applied[str(version)] = str(row.get("applied_at", ""))
    return applied


def apply_migrations(
    client: EltClient,
    workspace_id: int,
    database_id: int,
    migrations: List[Dict[str, str]],
    *,
    dry_run: bool = False,
) -> Dict:
    return client.apply_database_migrations(
        workspace_id,
        database_id,
        migrations,
        dry_run=dry_run,
    )


__all__ = ["EltClientError", "make_client", "fetch_applied_versions", "apply_migrations", "get_access_token"]
