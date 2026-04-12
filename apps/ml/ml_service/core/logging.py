from __future__ import annotations

import json
import logging
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from ml_service.core.request_context import get_job_id, get_request_id, get_route_path


REDACTED = "***REDACTED***"
SENSITIVE_FIELD_MARKERS = (
    "authorization",
    "token",
    "api_key",
    "apikey",
    "secret",
    "password",
)
SENSITIVE_CONTAINER_FIELDS = {"callback_headers"}


def _normalized_field_name(name: str) -> str:
    return name.strip().lower().replace("-", "_")


def _is_sensitive_field(name: str) -> bool:
    normalized = _normalized_field_name(name)
    return any(marker in normalized for marker in SENSITIVE_FIELD_MARKERS)


def redact_payload(payload: Any, *, force_redaction: bool = False) -> Any:
    if isinstance(payload, Mapping):
        redacted: dict[str, Any] = {}
        for key, value in payload.items():
            normalized = _normalized_field_name(str(key))
            if force_redaction or normalized in SENSITIVE_CONTAINER_FIELDS or _is_sensitive_field(str(key)):
                redacted[str(key)] = REDACTED if not isinstance(value, Mapping) else redact_payload(value, force_redaction=True)
                continue
            redacted[str(key)] = redact_payload(value)
        return redacted
    if isinstance(payload, Sequence) and not isinstance(payload, (str, bytes, bytearray)):
        return [redact_payload(item, force_redaction=force_redaction) for item in payload]
    if force_redaction:
        return REDACTED
    return payload


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if hasattr(record, "extra_payload"):
            record.extra_payload = redact_payload(getattr(record, "extra_payload"))
        return True


class DynamicStderrHandler(logging.StreamHandler):
    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stderr
        super().emit(record)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", get_request_id()),
        }
        route = getattr(record, "route", get_route_path())
        if route and route != "-":
            payload["route"] = route
        job_id = getattr(record, "job_id", get_job_id())
        if job_id and job_id != "-":
            payload["job_id"] = job_id
        if hasattr(record, "extra_payload"):
            payload.update(redact_payload(record.extra_payload))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def configure_logging() -> None:
    handler = DynamicStderrHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.filters.clear()
    root.addFilter(RedactingFilter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    for name, logger in logging.root.manager.loggerDict.items():
        if not isinstance(logger, logging.Logger):
            continue
        if name.startswith("ml_service"):
            logger.disabled = False
            logger.propagate = True


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.disabled = False
    logger.propagate = True
    if not any(isinstance(existing_filter, RedactingFilter) for existing_filter in logger.filters):
        logger.addFilter(RedactingFilter())
    return logger
