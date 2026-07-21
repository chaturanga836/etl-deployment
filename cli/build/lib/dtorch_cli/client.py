"""API client wrapper for CLI commands."""

from __future__ import annotations

import os
from typing import Dict, List, Optional

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
