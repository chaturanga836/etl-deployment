"""Runtime SDK client — workspace API key authentication."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from elt_sdk.client import EltClientError


class EltRuntimeClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str,
        workspace_id: int,
        timeout: float = 60.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._workspace_id = workspace_id
        self._timeout = timeout

    def _headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        with httpx.Client(timeout=self._timeout) as client:
            response = client.request(
                method,
                url,
                headers=self._headers(),
                json=json,
            )
        if response.status_code >= 400:
            raise EltClientError(response.text, response.status_code)
        if response.status_code == 204:
            return None
        return response.json()

    def run_pipeline(
        self,
        pipeline_uuid: str,
        *,
        input_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/pipelines/{pipeline_uuid}/run",
            json={"input": input_payload},
        )

    def run_workflow(
        self,
        workflow_uuid: str,
        *,
        input_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/workflows/{workflow_uuid}/run",
            json={"input": input_payload},
        )

    def invoke_rest(
        self,
        connection_id: int,
        *,
        path: Optional[str] = None,
        method: Optional[str] = None,
        variables: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/rest/{connection_id}/invoke",
            json={
                "path": path,
                "method": method,
                "variables": variables or {},
                "body": body,
            },
        )
