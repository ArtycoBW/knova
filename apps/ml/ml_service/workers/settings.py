from __future__ import annotations

from arq.connections import RedisSettings

from ml_service.core.config import get_settings
from ml_service.services.platform import run_job_inprocess


async def run_job(_: dict, job_id: str):
    return await run_job_inprocess(job_id)


settings = get_settings()


class WorkerSettings:
    functions = [run_job]
    redis_settings = RedisSettings(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password,
        database=0,
    )
    max_jobs = 4
    job_timeout = 60 * 30
