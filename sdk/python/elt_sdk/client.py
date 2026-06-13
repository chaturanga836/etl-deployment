"""Thin HTTP client for the ELT Engine public API."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import httpx


class EltClientError(Exception):
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


class EltClient:
    def __init__(
        self,
        base_url: str,
        *,
        get_access_token: Optional[Callable[[], Optional[str]]] = None,
        timeout: float = 30.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._get_access_token = get_access_token
        self._timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._get_access_token:
            token = self._get_access_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    def _request(self, method: str, path: str, json: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self._base_url}{path}"
        with httpx.Client(timeout=self._timeout) as client:
            response = client.request(method, url, headers=self._headers(), json=json)
        if response.status_code >= 400:
            raise EltClientError(response.text, response.status_code)
        if response.status_code == 204:
            return None
        return response.json()

    def signup(self, *, email: str, password: str, org_name: str) -> Dict[str, Any]:
        return self._request(
            "POST",
            "/api/v1/auth/signup",
            {"email": email, "password": password, "org_name": org_name},
        )

    def get_account(self) -> Dict[str, Any]:
        return self._request("GET", "/api/v1/studio/account")

    def list_projects(self, org_id: Optional[int] = None) -> Dict[str, Any]:
        path = "/api/v1/studio/projects"
        if org_id is not None:
            path = f"{path}?org_id={org_id}"
        return self._request("GET", path)

    def create_project(
        self,
        body: Dict[str, Any],
        *,
        org_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        path = "/api/v1/studio/projects"
        if org_id is not None:
            path = f"{path}?org_id={org_id}"
        return self._request("POST", path, body)

    def list_services(self, *, available_only: bool = False) -> List[Any]:
        path = "/api/v1/studio/services"
        if available_only:
            path = f"{path}?available_only=true"
        return self._request("GET", path)

    def list_workspaces(self) -> Dict[str, Any]:
        return self._request("GET", "/api/v1/workspaces/")
