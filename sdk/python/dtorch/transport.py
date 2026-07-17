"""Shared synchronous HTTP transport for DT Orch clients."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

import httpx

from dtorch.errors import DtorchApiError, DtorchAuthError, DtorchValidationError

AccessTokenProvider = Callable[[], Optional[str]]


class HttpTransport:
    def __init__(
        self,
        base_url: str,
        *,
        get_access_token: Optional[AccessTokenProvider] = None,
        project_key: Optional[str] = None,
        project_secret: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 60.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.get_access_token = get_access_token
        self.project_key = project_key
        self.project_secret = project_secret
        self.api_key = api_key
        self.timeout = timeout

        if bool(project_key) != bool(project_secret):
            raise DtorchValidationError("project_key and project_secret must be provided together")

    def headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.project_key and self.project_secret:
            headers["X-Project-Key"] = self.project_key
            headers["Authorization"] = f"Bearer {self.project_secret}"
        elif self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        elif self.get_access_token:
            token = self.get_access_token()
            if token:
                headers["Authorization"] = f"Bearer {token}"
        return headers

    def request(self, method: str, path: str, json: Optional[Any] = None) -> Any:
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=self.headers(),
                    json=json,
                )
        except httpx.TimeoutException as exc:
            raise DtorchApiError(f"DT Orch API request timed out: {method} {path}") from exc
        except httpx.RequestError as exc:
            raise DtorchApiError(f"DT Orch API request failed: {method} {path}") from exc

        if response.status_code >= 400:
            try:
                detail: Any = response.json()
            except ValueError:
                detail = response.text
            if response.status_code in {401, 403}:
                message = (
                    "DT Orch authentication failed; verify or regenerate your project "
                    "credentials in Studio"
                    if self.project_key
                    else "DT Orch authentication or authorization failed; verify the token "
                    "and required scopes or roles"
                )
                raise DtorchAuthError(
                    message,
                    response.status_code,
                    detail,
                )
            raise DtorchApiError(
                f"DT Orch API {method} {path} failed ({response.status_code})",
                response.status_code,
                detail,
            )
        if response.status_code == 204:
            return None
        return response.json()
