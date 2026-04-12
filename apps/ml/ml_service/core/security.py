from __future__ import annotations

from fastapi import Header, HTTPException, status

from ml_service.core.config import Settings
from ml_service.core.request_context import get_request_id


def authorize_request(settings: Settings, authorization: str | None) -> None:
    if settings.auth_is_disabled():
        return
    expected = settings.bearer_token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "auth_not_configured",
                "message": "Bearer auth is enabled but no token is configured.",
                "request_id": get_request_id(),
            },
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "missing_bearer_token",
                "message": "Missing bearer token.",
                "request_id": get_request_id(),
            },
        )
    token = authorization.split(" ", 1)[1].strip()
    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_bearer_token",
                "message": "Invalid bearer token.",
                "request_id": get_request_id(),
            },
        )


async def require_bearer_token(
    authorization: str | None = Header(default=None),
) -> None:
    from ml_service.core.config import get_settings

    authorize_request(get_settings(), authorization)
