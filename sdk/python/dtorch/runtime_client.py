"""Workspace API-key client for DT Orch runtime automation."""

from __future__ import annotations

from typing import Any, Dict, Optional
from urllib.parse import quote

from dtorch.transport import HttpTransport


class DtorchRuntimeClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str,
        workspace_id: int,
        timeout: float = 60.0,
    ) -> None:
        self.workspace_id = workspace_id
        self._http = HttpTransport(base_url, api_key=api_key, timeout=timeout)

    def run_pipeline(
        self,
        pipeline_uuid: str,
        *,
        input_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}"
            f"/pipelines/{quote(pipeline_uuid, safe='')}/run",
            {"input": input_payload},
        )

    def run_workflow(
        self,
        workflow_uuid: str,
        *,
        input_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}"
            f"/workflows/{quote(workflow_uuid, safe='')}/run",
            {"input": input_payload},
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
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}/rest/{connection_id}/invoke",
            {
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
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}/queues/"
            f"{quote(queue_name, safe='')}/push",
            {"payload": payload or {}},
        )

    def queue_pop(self, queue_name: str) -> Optional[Dict[str, Any]]:
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}/queues/"
            f"{quote(queue_name, safe='')}/pop",
        )

    def notification_publish(
        self,
        channel: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        target: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        request_body: Dict[str, Any] = {
            "channel": channel,
            "payload": payload or {},
        }
        if target is not None:
            request_body["target"] = target
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}/notifications/publish",
            request_body,
        )

    def cron_push_logs(
        self,
        job_name: str,
        *,
        message: str,
        level: str = "info",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Push a cron history log entry (requires ``cron:log`` scope).

        Always callable; the platform stores the row only when the job has
        ``history_log`` enabled.
        """
        return self._http.request(
            "POST",
            f"/api/v1/runtime/workspaces/{self.workspace_id}/cron-jobs/"
            f"{quote(job_name, safe='')}/logs",
            {
                "message": message,
                "level": level,
                "metadata": metadata or {},
            },
        )


# Backward-compatible class name.
EltRuntimeClient = DtorchRuntimeClient
