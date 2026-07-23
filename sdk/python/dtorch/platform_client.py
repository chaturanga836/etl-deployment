"""Project-credential client for workspace platform services."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlencode

from dtorch.database import DatabaseContext
from dtorch.errors import DtorchValidationError
from dtorch.runtime_client import DtorchRuntimeClient
from dtorch.transport import HttpTransport


class DtorchPlatformClient:
    """Access project-scoped services with a Studio project key and secret."""

    def __init__(
        self,
        base_url: str,
        *,
        project_key: str,
        project_secret: str,
        workspace_id: int,
        database_id: Optional[int] = None,
        timeout: float = 60.0,
    ) -> None:
        self.workspace_id = workspace_id
        self.default_database_id = database_id
        self._http = HttpTransport(
            base_url,
            project_key=project_key,
            project_secret=project_secret,
            timeout=timeout,
        )
        self.runtime = DtorchRuntimeClient(
            base_url,
            workspace_id=workspace_id,
            project_key=project_key,
            project_secret=project_secret,
            timeout=timeout,
        )

    def validate(self) -> Dict[str, Any]:
        response = self.list_databases()
        return {
            "ok": True,
            "workspace_id": self.workspace_id,
            "databases": response.get("databases", []),
        }

    def database(self, database_id: int) -> DatabaseContext:
        return DatabaseContext(self, database_id)

    @property
    def db(self) -> DatabaseContext:
        if self.default_database_id is None:
            raise DtorchValidationError(
                "No default database configured; pass database_id or call database(id)"
            )
        return self.database(self.default_database_id)

    def list_databases(self) -> Dict[str, Any]:
        return self._http.request(
            "GET",
            f"/api/v1/workspaces/{self.workspace_id}/databases",
        )

    def list_tables(self, database_id: int) -> Dict[str, Any]:
        return self._http.request(
            "GET",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}/tables",
        )

    def get_table_detail(self, database_id: int, table_name: str) -> Dict[str, Any]:
        encoded_name = quote(table_name, safe="")
        return self._http.request(
            "GET",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}"
            f"/tables/{encoded_name}",
        )

    def get_table_data(
        self,
        database_id: int,
        table_name: str,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        query_values: Dict[str, int] = {}
        if limit is not None:
            query_values["limit"] = limit
        if offset is not None:
            query_values["offset"] = offset
        query = f"?{urlencode(query_values)}" if query_values else ""
        encoded_name = quote(table_name, safe="")
        return self._http.request(
            "GET",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}"
            f"/tables/{encoded_name}/data{query}",
        )

    def execute_sql(self, database_id: int, sql: str) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}/sql",
            {"sql": sql},
        )

    def list_database_migrations(self, database_id: int) -> Dict[str, Any]:
        return self._http.request(
            "GET",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}/migrations",
        )

    def apply_database_migrations(
        self,
        database_id: int,
        migrations: List[Dict[str, str]],
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            f"/api/v1/workspaces/{self.workspace_id}/databases/{database_id}/migrations/apply",
            {"migrations": migrations, "dry_run": dry_run},
        )


# Backward-compatible class name.
EltPlatformClient = DtorchPlatformClient
