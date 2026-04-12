from __future__ import annotations

from fastapi import HTTPException, Request, status
from redis.asyncio import Redis

from ml_service.core.request_context import get_request_id


class RateLimiter:
    def __init__(self, redis: Redis | None, per_minute: int) -> None:
        self.redis = redis
        self.per_minute = per_minute

    async def check(self, request: Request) -> None:
        if not self.redis or self.per_minute <= 0:
            return
        client_host = request.client.host if request.client else "unknown"
        key = f"rate_limit:{client_host}:{request.url.path}"
        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, 60)
        if current > self.per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "rate_limit_exceeded",
                    "message": "Too many requests.",
                    "request_id": get_request_id(),
                },
            )
