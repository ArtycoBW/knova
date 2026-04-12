from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from ml_service.core.config import Settings

def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.resolved_database_url,
        future=True,
        pool_pre_ping=True,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_database(engine: AsyncEngine, settings: Settings) -> None:
    async with engine.begin() as connection:
        if settings.resolved_database_url.startswith("postgresql+asyncpg://") and settings.resolved_db_schema:
            await connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.resolved_db_schema}"'))
    await asyncio.to_thread(run_migrations, settings)


def run_migrations(settings: Settings) -> None:
    config = Config(str(settings.repo_root / "apps/ml/alembic.ini"))
    config.set_main_option("script_location", str(Path(settings.repo_root / "apps/ml/alembic").resolve()))
    config.set_main_option(
        "sqlalchemy.url",
        settings.resolved_database_url.replace("+asyncpg", "").replace("+aiosqlite", ""),
    )
    command.upgrade(config, "head")


async def get_session_from_factory(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
