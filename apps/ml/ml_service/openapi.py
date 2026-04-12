from __future__ import annotations

from functools import lru_cache
from typing import Any

import yaml
from fastapi import FastAPI

from ml_service.core.config import Settings


@lru_cache
def load_openapi_spec(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def install_openapi_schema(app: FastAPI, settings: Settings) -> None:
    def custom_openapi() -> dict[str, Any]:
        return load_openapi_spec(str(settings.openapi_spec_path))

    app.openapi = custom_openapi
