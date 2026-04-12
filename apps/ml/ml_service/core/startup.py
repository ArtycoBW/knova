from __future__ import annotations

import shutil

from ml_service.core.config import Settings


def validate_runtime_settings(settings: Settings) -> None:
    errors: list[str] = []
    storage_backend = settings.storage_backend.lower()

    if storage_backend not in {"local", "s3"}:
        errors.append("AI_SERVICE_STORAGE_BACKEND must be one of: local, s3.")

    if storage_backend == "s3":
        if not settings.s3_bucket:
            errors.append("AI_SERVICE_S3_BUCKET is required when AI_SERVICE_STORAGE_BACKEND=s3.")
        if not settings.s3_access_key_id:
            errors.append("AI_SERVICE_S3_ACCESS_KEY_ID is required when AI_SERVICE_STORAGE_BACKEND=s3.")
        if not settings.s3_secret_access_key:
            errors.append("AI_SERVICE_S3_SECRET_ACCESS_KEY is required when AI_SERVICE_STORAGE_BACKEND=s3.")

    if not settings.templates_path.exists():
        errors.append(f"Template directory does not exist: {settings.templates_path}")
    elif not settings.templates_path.is_dir():
        errors.append(f"Template path is not a directory: {settings.templates_path}")

    if settings.is_production():
        if settings.auth_disabled:
            errors.append("AI_SERVICE_DISABLE_AUTH cannot be true in production.")
        if not settings.bearer_token:
            errors.append("AI_SERVICE_BEARER_TOKEN is required in production.")
        if not (settings.database_url or settings.fallback_database_url):
            errors.append("AI_SERVICE_DATABASE_URL or DATABASE_URL is required in production.")
        for binary_name, label in (
            (settings.ffmpeg_binary, "FFMPEG_BINARY"),
            (settings.libreoffice_binary, "LIBREOFFICE_BINARY"),
        ):
            if not shutil.which(binary_name):
                errors.append(f"{label} points to an unavailable binary: {binary_name}")

    if errors:
        raise RuntimeError("Invalid AI service runtime configuration:\n- " + "\n- ".join(errors))
