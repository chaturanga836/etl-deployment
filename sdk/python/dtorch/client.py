"""JWT-authenticated DT Orch Studio client."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from dtorch.errors import DtorchApiError, DtorchAuthError, DtorchMigrationError
from dtorch.transport import AccessTokenProvider, HttpTransport


class DtorchClient:
    """Manage Studio resources and database migrations using a user JWT."""

    def __init__(
        self,
        base_url: str,
        *,
        get_access_token: Optional[AccessTokenProvider] = None,
        timeout: float = 60.0,
    ) -> None:
        self._http = HttpTransport(
            base_url,
            get_access_token=get_access_token,
            timeout=timeout,
        )

    def signup(self, *, email: str, password: str, org_name: str) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            "/api/v1/auth/signup",
            {"email": email, "password": password, "org_name": org_name},
        )

    def get_account(self) -> Dict[str, Any]:
        return self._http.request("GET", "/api/v1/studio/account")

    def list_projects(self, org_id: Optional[int] = None) -> Dict[str, Any]:
        query = f"?org_id={org_id}" if org_id is not None else ""
        return self._http.request("GET", f"/api/v1/studio/projects{query}")

    def create_project(
        self,
        body: Dict[str, Any],
        *,
        org_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        query = f"?org_id={org_id}" if org_id is not None else ""
        return self._http.request("POST", f"/api/v1/studio/projects{query}", body)

    def get_project_credentials(self, project_id: int) -> Dict[str, Any]:
        return self._http.request(
            "GET",
            f"/api/v1/studio/projects/{project_id}/credentials",
        )

    def regenerate_project_credentials(self, project_id: int) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            f"/api/v1/studio/projects/{project_id}/credentials/regenerate",
        )

    def list_services(self, *, available_only: bool = False) -> List[Any]:
        query = "?available_only=true" if available_only else ""
        return self._http.request("GET", f"/api/v1/studio/services{query}")

    def list_workspaces(self) -> Dict[str, Any]:
        return self._http.request("GET", "/api/v1/workspaces/")

    def list_database_migrations(
        self,
        workspace_id: int,
        database_id: int,
    ) -> Dict[str, Any]:
        try:
            return self._http.request(
                "GET",
                f"/api/v1/workspaces/{workspace_id}/databases/{database_id}/migrations",
            )
        except DtorchAuthError:
            raise
        except DtorchApiError as exc:
            raise DtorchMigrationError(str(exc), exc.status_code, exc.detail) from exc

    def apply_database_migrations(
        self,
        workspace_id: int,
        database_id: int,
        migrations: List[Dict[str, str]],
        *,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        try:
            return self._http.request(
                "POST",
                f"/api/v1/workspaces/{workspace_id}/databases/{database_id}/migrations/apply",
                {"migrations": migrations, "dry_run": dry_run},
            )
        except DtorchAuthError:
            raise
        except DtorchApiError as exc:
            raise DtorchMigrationError(str(exc), exc.status_code, exc.detail) from exc


# Backward-compatible class name.
EltClient = DtorchClient
