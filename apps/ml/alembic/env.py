from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from ml_service.core.config import get_settings
from ml_service.db.models import Base


config = context.config
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.resolved_database_url.replace("+asyncpg", "").replace("+aiosqlite", ""))

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
target_schema = settings.resolved_db_schema


def include_name(name: str | None, type_: str, parent_names: dict[str, str | None]) -> bool:
    if type_ == "schema":
        if target_schema:
            return name == target_schema
        return name in {None, ""}
    if type_ == "table":
        schema_name = parent_names.get("schema_name")
        if target_schema:
            return schema_name == target_schema
        return schema_name in {None, ""}
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=bool(target_schema),
        include_name=include_name,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=bool(target_schema),
            include_name=include_name,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
