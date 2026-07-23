"""API client wrapper for CLI commands."""

from __future__ import annotations

import os
from typing import Dict, List, Optional, Protocol, Union

from dtorch import DtorchClient, DtorchPlatformClient
from dtorch.errors import DtorchApiError as EltClientError


class MigrationClient(Protocol):
    def list_database_migrations(self, workspace_id: int, database_id: int) -> Dict:
        ...

    def apply_database_migrations(
        self,
        workspace_id: int,
        database_id: int,
        migrations: List[Dict[str, str]],
        *,
        dry_run: bool = False,
    ) -> Dict:
        ...


class _PlatformMigrationAdapter:
    """Adapt DtorchPlatformClient (project creds) to the CLI migration interface."""

    def __init__(self, client: DtorchPlatformClient) -> None:
        self._client = client

    def list_database_migrations(self, workspace_id: int, database_id: int) -> Dict:
        _ = workspace_id
        return self._client.list_database_migrations(database_id)

    def apply_database_migrations(
        self,
        workspace_id: int,
        database_id: int,
        migrations: List[Dict[str, str]],
        *,
        dry_run: bool = False,
    ) -> Dict:
        _ = workspace_id
        return self._client.apply_database_migrations(
            database_id,
            migrations,
            dry_run=dry_run,
        )


def get_access_token() -> Optional[str]:
    return os.environ.get("DTORCH_ACCESS_TOKEN") or os.environ.get("ELT_ACCESS_TOKEN")


def get_project_credentials() -> tuple[Optional[str], Optional[str]]:
    key = os.environ.get("DTORCH_PROJECT_KEY") or os.environ.get("ELT_PROJECT_KEY")
    secret = os.environ.get("DTORCH_PROJECT_SECRET") or os.environ.get("ELT_PROJECT_SECRET")
    return key, secret


def has_auth() -> bool:
    key, secret = get_project_credentials()
    if key and secret:
        return True
    return bool(get_access_token())


def make_platform_client(api_url: str, workspace_id: int) -> DtorchPlatformClient:
    """Project key/secret client (required for runtime queue demos)."""
    key, secret = get_project_credentials()
    if not key or not secret:
        raise EltClientError(
            "Set DTORCH_PROJECT_KEY and DTORCH_PROJECT_SECRET in .env",
            401,
            None,
        )
    return DtorchPlatformClient(
        api_url,
        project_key=key,
        project_secret=secret,
        workspace_id=workspace_id,
    )


def make_client(api_url: str, workspace_id: int) -> Union[_PlatformMigrationAdapter, DtorchClient]:
    """Prefer project key/secret; fall back to Studio JWT."""
    key, secret = get_project_credentials()
    if key and secret:
        return _PlatformMigrationAdapter(
            DtorchPlatformClient(
                api_url,
                project_key=key,
                project_secret=secret,
                workspace_id=workspace_id,
            )
        )
    return DtorchClient(api_url, get_access_token=get_access_token)


def fetch_applied_versions(client: MigrationClient, workspace_id: int, database_id: int) -> Dict[str, str]:
    payload = client.list_database_migrations(workspace_id, database_id)
    applied: Dict[str, str] = {}
    for row in payload.get("migrations", []):
        version = row.get("version")
        if version:
            applied[str(version)] = str(row.get("applied_at", ""))
    return applied


def apply_migrations(
    client: MigrationClient,
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


__all__ = [
    "EltClientError",
    "make_client",
    "make_platform_client",
    "fetch_applied_versions",
    "apply_migrations",
    "get_access_token",
    "get_project_credentials",
    "has_auth",
]
