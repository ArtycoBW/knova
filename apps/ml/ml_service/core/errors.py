from __future__ import annotations

from typing import Any


class ServiceError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str,
        status_code: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}


class LimitExceededError(ServiceError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "payload_too_large",
        status_code: int = 413,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, code=code, status_code=status_code, details=details)


class MediaValidationError(ServiceError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "invalid_media",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message, code=code, status_code=400, details=details)


class JobCancelledError(RuntimeError):
    def __init__(self, job_id: str, operation: str) -> None:
        super().__init__(f"Job '{job_id}' was cancelled during '{operation}'.")
        self.job_id = job_id
        self.operation = operation
