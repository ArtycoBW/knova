from __future__ import annotations

from pathlib import Path

def default_database_url() -> str:
    repo_root = _discover_repo_root(Path(__file__))
    return f"sqlite:///{(repo_root / 'apps/ml/app.db').resolve()}"


def _discover_repo_root(start: Path) -> Path:
    candidate = start.resolve()
    for path in (candidate, *candidate.parents):
        if (path / "ai-service-openapi.yaml").exists() and (path / "apps" / "ml").exists():
            return path
    return candidate.parents[4]


def resolve_database_url(raw_database_url: str | None) -> str:
    raw = raw_database_url or default_database_url()
    if raw.startswith("postgresql://"):
        return raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql+asyncpg://", 1)
    if raw.startswith("sqlite:///"):
        return raw.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    return raw


def resolve_db_schema(raw_schema: str | None, raw_database_url: str | None) -> str | None:
    schema = raw_schema.strip() if isinstance(raw_schema, str) else raw_schema
    database_url = raw_database_url or default_database_url()
    if database_url.startswith("sqlite"):
        return None
    return schema or "ml"
