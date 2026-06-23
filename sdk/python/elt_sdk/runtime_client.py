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

    def queue_push(
        self,
        queue_name: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Push a message onto a queue. Requires scope queue:push."""
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/queues/{queue_name}/push",
            json={"payload": payload or {}},
        )

    def queue_pop(self, queue_name: str) -> Optional[Dict[str, Any]]:
        """Pop the oldest message (destructive — message is removed). Requires scope queue:pop.

        Returns None if the queue is empty.
        """
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/queues/{queue_name}/pop",
        )

    def notification_publish(
        self,
        channel: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        target: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Publish a realtime notification. Requires scope notification:publish."""
        body: Dict[str, Any] = {"channel": channel, "payload": payload or {}}
        if target is not None:
            body["target"] = target
        return self._request(
            "POST",
            f"/api/v1/runtime/workspaces/{self._workspace_id}/notifications/publish",
            json=body,
        )
