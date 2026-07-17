"""Typed DT Orch SDK errors."""

from __future__ import annotations

from typing import Any, Optional


class DtorchApiError(Exception):
    """Base error for HTTP and platform API failures."""

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        detail: Optional[Any] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class DtorchAuthError(DtorchApiError):
    """Authentication or authorization failed."""


class DtorchMigrationError(DtorchApiError):
    """A migration list or apply request failed."""


class DtorchServiceNotEnabledError(DtorchApiError):
    """A requested workspace service has not been enabled."""

    def __init__(self, service: str, message: Optional[str] = None) -> None:
        super().__init__(message or f"DT Orch service '{service}' is not enabled", 404)
        self.service = service


class DtorchValidationError(DtorchApiError):
    """Invalid local SDK input or configuration."""

    def __init__(self, message: str, detail: Optional[Any] = None) -> None:
        super().__init__(message, 0, detail)


# Backward-compatible exception name.
EltClientError = DtorchApiError
