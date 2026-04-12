from __future__ import annotations

import os
import sys
import logging
from contextlib import contextmanager
from io import StringIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


REPO_ROOT = Path(__file__).resolve().parents[3]
APPS_ML_ROOT = REPO_ROOT / "apps/ml"

if str(APPS_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(APPS_ML_ROOT))

os.environ.setdefault("AI_SERVICE_DB_SCHEMA", "")
os.environ.setdefault("AI_SERVICE_DISABLE_AUTH", "true")
os.environ.setdefault("AI_SERVICE_INLINE_ASYNC_JOBS", "true")
os.environ.setdefault("AI_SERVICE_ALLOW_STUB_GENERATORS", "true")
os.environ.setdefault("AI_SERVICE_TEMPLATE_DIR", str(REPO_ROOT / "apps/ml/templates"))


@contextmanager
def _build_test_client(tmp_path: Path, **env_overrides: str):
    previous_values: dict[str, str | None] = {}
    default_env = {
        "AI_SERVICE_DATABASE_URL": f"sqlite:///{tmp_path / 'test.db'}",
        "AI_SERVICE_ARTIFACT_ROOT": str(tmp_path / "artifacts"),
    }
    for key, value in {**default_env, **env_overrides}.items():
        previous_values[key] = os.environ.get(key)
        os.environ[key] = str(value)
    from ml_service.core.config import get_settings

    get_settings.cache_clear()
    from ml_service.app import create_app

    try:
        with TestClient(create_app()) as test_client:
            yield test_client
    finally:
        for key, previous in previous_values.items():
            if previous is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = previous
        get_settings.cache_clear()


@contextmanager
def _capture_json_logs(*logger_names: str):
    from ml_service.core.logging import JsonFormatter, RedactingFilter

    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactingFilter())
    target_names = logger_names or ("root",)
    attached_loggers: list[logging.Logger] = []
    for logger_name in target_names:
        logger = logging.getLogger() if logger_name == "root" else logging.getLogger(logger_name)
        logger.addHandler(handler)
        attached_loggers.append(logger)
    try:
        yield stream
    finally:
        handler.flush()
        for logger in attached_loggers:
            if handler in logger.handlers:
                logger.removeHandler(handler)


@pytest.fixture()
def client_factory(tmp_path: Path):
    def factory(**env_overrides: str):
        return _build_test_client(tmp_path, **env_overrides)

    return factory


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    with _build_test_client(tmp_path) as test_client:
        yield test_client


@pytest.fixture()
def json_log_capture():
    yield _capture_json_logs
