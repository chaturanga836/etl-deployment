from __future__ import annotations

from typing import Any

import pytest

from dtorch import (
    DtorchAuthError,
    DtorchClient,
    DtorchPlatformClient,
    EltClient,
)
from dtorch.database import TableModel
from dtorch.transport import HttpTransport


def test_legacy_client_alias() -> None:
    from elt_sdk.client import EltClient as DirectLegacyClient

    assert EltClient is DtorchClient
    assert DirectLegacyClient is DtorchClient


def test_platform_validate_uses_project_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    request: dict[str, Any] = {}

    def fake_request(
        self: HttpTransport,
        method: str,
        path: str,
        json: Any = None,
    ) -> dict[str, Any]:
        request.update(
            method=method,
            path=path,
            headers=self.headers(),
            json=json,
        )
        return {"databases": [], "has_databases": False}

    monkeypatch.setattr(HttpTransport, "request", fake_request)
    client = DtorchPlatformClient(
        "https://dtorch.example/",
        project_key="pk_test",
        project_secret="ps_test",
        workspace_id=42,
    )

    assert client.validate() == {
        "ok": True,
        "workspace_id": 42,
        "databases": [],
    }
    assert request["path"] == "/api/v1/workspaces/42/databases"
    assert request["headers"]["X-Project-Key"] == "pk_test"
    assert request["headers"]["Authorization"] == "Bearer ps_test"


def test_platform_apply_migrations_uses_project_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    def fake_request(
        self: HttpTransport,
        method: str,
        path: str,
        json: Any = None,
    ) -> dict[str, Any]:
        request.update(
            method=method,
            path=path,
            headers=self.headers(),
            json=json,
        )
        return {
            "ok": True,
            "dry_run": False,
            "applied_versions": ["20260718100000_create_demo_jobs"],
            "statements_executed": 1,
        }

    monkeypatch.setattr(HttpTransport, "request", fake_request)
    client = DtorchPlatformClient(
        "https://dtorch.example/",
        project_key="pk_test",
        project_secret="ps_test",
        workspace_id=42,
    )

    result = client.apply_database_migrations(
        1,
        [{"version": "20260718100000_create_demo_jobs", "sql": "CREATE TABLE demo_jobs (id int);"}],
    )
    assert result["applied_versions"] == ["20260718100000_create_demo_jobs"]
    assert request["method"] == "POST"
    assert request["path"] == "/api/v1/workspaces/42/databases/1/migrations/apply"
    assert request["headers"]["X-Project-Key"] == "pk_test"
    assert request["headers"]["Authorization"] == "Bearer ps_test"


def test_update_by_pk_only_updates_changes() -> None:
    class FakeClient:
        sql = ""

        def get_table_detail(self, database_id: int, table_name: str) -> dict[str, Any]:
            return {
                "database_id": database_id,
                "schema_name": "public",
                "table_name": table_name,
                "columns": [
                    {"name": "id", "primary_key": True},
                    {"name": "name", "primary_key": False},
                    {"name": "email", "primary_key": False},
                ],
            }

        def execute_sql(self, database_id: int, sql: str) -> dict[str, Any]:
            self.sql = sql
            return {"ok": True, "statement_type": "update"}

    client = FakeClient()
    table = TableModel(client, 1, "users")  # type: ignore[arg-type]
    table.update_by_pk({"id": 7}, {"name": "Ada"})

    assert '"name" = \'Ada\'' in client.sql
    assert 'WHERE "id" = 7' in client.sql
    assert '"email" = NULL' not in client.sql


def test_transport_maps_unauthorized_to_auth_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResponse:
        status_code = 401
        text = '{"detail":"Invalid project credentials"}'

        def json(self) -> dict[str, str]:
            return {"detail": "Invalid project credentials"}

    class FakeClient:
        def __init__(self, **_: Any) -> None:
            pass

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_: Any) -> None:
            pass

        def request(self, *_: Any, **__: Any) -> FakeResponse:
            return FakeResponse()

    monkeypatch.setattr("dtorch.transport.httpx.Client", FakeClient)
    transport = HttpTransport(
        "https://dtorch.example",
        project_key="pk_bad",
        project_secret="ps_bad",
    )

    with pytest.raises(DtorchAuthError) as error:
        transport.request("GET", "/api/v1/workspaces/42/databases")
    assert error.value.status_code == 401
