from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ml_service.core.security import require_bearer_token
from ml_service.services.platform import PlatformService


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


async def get_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> PlatformService:
    return PlatformService(
        session=session,
        session_factory=request.app.state.session_factory,
        settings=request.app.state.settings,
        provider_manager=request.app.state.provider_manager,
        storage=request.app.state.storage,
    )


AuthorizedService = Depends(require_bearer_token)
