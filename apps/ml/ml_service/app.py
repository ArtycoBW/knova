from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, ORJSONResponse
from redis.asyncio import Redis

from ml_service.api.routes import router
from ml_service.core.config import get_settings
from ml_service.core.errors import ServiceError
from ml_service.core.logging import configure_logging, get_logger
from ml_service.core.rate_limit import RateLimiter
from ml_service.core.request_context import get_job_id, request_id_var, route_path_var
from ml_service.core.startup import validate_runtime_settings
from ml_service.db.session import create_engine, create_session_factory, init_database
from ml_service.openapi import install_openapi_schema
from ml_service.providers.base import ProviderError, UnsupportedCapabilityError
from ml_service.providers.manager import ProviderManager
from ml_service.storage.factory import build_artifact_storage


logger = get_logger(__name__)


def error_payload(message: str, code: str, *, details: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "code": code,
        "message": message,
        "request_id": request_id_var.get(),
    }
    if details:
        payload["details"] = details
    return payload


def _request_bytes_exceed_limit(request: Request, max_bytes: int) -> bool:
    content_length = request.headers.get("content-length")
    if content_length is None:
        return False
    try:
        return int(content_length) > max_bytes
    except ValueError:
        return False


def _is_json_request(content_type: str) -> bool:
    lowered = content_type.lower()
    return "application/json" in lowered or lowered.endswith("+json")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging()
    validate_runtime_settings(settings)
    engine = create_engine(settings)
    if settings.auto_migrate:
        await init_database(engine, settings)
        configure_logging()
    session_factory = create_session_factory(engine)
    redis = None
    try:
        redis = Redis.from_url(settings.resolved_redis_url, decode_responses=False)
        await redis.ping()
    except Exception:  # noqa: BLE001
        redis = None

    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.redis = redis
    app.state.provider_manager = ProviderManager(settings)
    app.state.storage = build_artifact_storage(settings)
    app.state.rate_limiter = RateLimiter(redis, settings.rate_limit_per_minute)
    yield
    if redis is not None:
        await redis.aclose()
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.service_name,
        version=settings.service_version,
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )
    install_openapi_schema(app, settings)

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        request_token = request_id_var.set(request_id)
        route_token = route_path_var.set(request.url.path)
        started_at = perf_counter()
        try:
            content_type = request.headers.get("content-type", "")
            if _is_json_request(content_type):
                if _request_bytes_exceed_limit(request, settings.max_json_body_bytes):
                    raise ServiceError(
                        "JSON request body exceeds the configured limit.",
                        code="payload_too_large",
                        status_code=413,
                        details={"limit_name": "json_body_bytes", "max_bytes": settings.max_json_body_bytes},
                    )
                body = await request.body()
                if len(body) > settings.max_json_body_bytes:
                    raise ServiceError(
                        "JSON request body exceeds the configured limit.",
                        code="payload_too_large",
                        status_code=413,
                        details={
                            "limit_name": "json_body_bytes",
                            "size_bytes": len(body),
                            "max_bytes": settings.max_json_body_bytes,
                        },
                    )
            elif "multipart/form-data" in content_type and _request_bytes_exceed_limit(request, settings.max_upload_bytes):
                raise ServiceError(
                    "Multipart upload exceeds the configured limit.",
                    code="payload_too_large",
                    status_code=413,
                    details={"limit_name": "upload_bytes", "max_bytes": settings.max_upload_bytes},
                )
            if request.url.path not in {"/health/live", "/health", "/health/ready"}:
                await app.state.rate_limiter.check(request)
            response = await call_next(request)
            response.headers["x-request-id"] = request_id
            logger.info(
                "Request completed",
                extra={
                    "extra_payload": {
                        "route": request.url.path,
                        "method": request.method,
                        "status_code": response.status_code,
                        "latency_ms": round((perf_counter() - started_at) * 1000, 2),
                    }
                },
            )
            return response
        except ServiceError as exc:
            logger.info(
                "Request rejected",
                extra={
                    "extra_payload": {
                        "route": request.url.path,
                        "reason": exc.code,
                        "job_id": get_job_id(),
                        "details": exc.details,
                        "status_code": exc.status_code,
                    }
                },
            )
            response = JSONResponse(
                status_code=exc.status_code,
                content=error_payload(exc.message, exc.code, details=exc.details),
            )
            response.headers["x-request-id"] = request_id
            return response
        except HTTPException:
            raise
        except Exception:
            logger.exception(
                "Request failed",
                extra={
                    "extra_payload": {
                        "route": request.url.path,
                        "method": request.method,
                        "latency_ms": round((perf_counter() - started_at) * 1000, 2),
                    }
                },
            )
            raise
        finally:
            route_path_var.reset(route_token)
            request_id_var.reset(request_token)

    @app.exception_handler(HTTPException)
    async def handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict) and {"code", "message"} <= set(detail.keys()):
            payload = detail
        else:
            payload = error_payload(str(detail), "http_error")
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload("Request validation failed.", "validation_error", details={"errors": exc.errors()}),
        )

    @app.exception_handler(UnsupportedCapabilityError)
    async def handle_unsupported_capability(_: Request, exc: UnsupportedCapabilityError) -> JSONResponse:
        return JSONResponse(status_code=400, content=error_payload(str(exc), "unsupported_capability"))

    @app.exception_handler(ProviderError)
    async def handle_provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(status_code=503, content=error_payload(str(exc), "provider_unavailable"))

    @app.exception_handler(ServiceError)
    async def handle_service_error(request: Request, exc: ServiceError) -> JSONResponse:
        logger.info(
            "Request rejected",
            extra={
                "extra_payload": {
                    "route": request.url.path,
                    "reason": exc.code,
                    "job_id": get_job_id(),
                    "details": exc.details,
                    "status_code": exc.status_code,
                }
            },
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.message, exc.code, details=exc.details),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error", extra={"extra_payload": {"request_id": request_id_var.get()}})
        return JSONResponse(status_code=500, content=error_payload(str(exc), "internal_error"))

    @app.get("/metrics", include_in_schema=False)
    async def metrics():
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
        from fastapi.responses import Response

        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/health", include_in_schema=False)
    async def legacy_health_alias():
        return {"status": "ok", "timestamp": datetime.now(UTC).isoformat()}

    app.include_router(router)
    return app
