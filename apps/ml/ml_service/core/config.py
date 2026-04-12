from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ml_service.db.schema import resolve_database_url, resolve_db_schema


def discover_repo_root(start: Path) -> Path:
    candidate = start.resolve()
    for path in (candidate, *candidate.parents):
        if (path / "ai-service-openapi.yaml").exists() and (path / "apps" / "ml").exists():
            return path
    return candidate.parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = Field(default="development", alias="NODE_ENV")
    service_name: str = "Knova AI Service"
    service_version: str = "1.0.0"
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    database_url: str | None = Field(default=None, alias="AI_SERVICE_DATABASE_URL")
    fallback_database_url: str | None = Field(default=None, alias="DATABASE_URL")
    db_schema: str | None = Field(default=None, alias="AI_SERVICE_DB_SCHEMA")
    auto_migrate: bool = Field(default=True, alias="AI_SERVICE_AUTO_MIGRATE")

    redis_url: str | None = Field(default=None, alias="AI_SERVICE_REDIS_URL")
    redis_host: str = Field(default="localhost", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_password: str | None = Field(default=None, alias="REDIS_PASSWORD")

    artifact_root: Path = Field(default=Path("apps/ml/data"), alias="AI_SERVICE_ARTIFACT_ROOT")
    template_dir: Path = Field(default=Path("apps/ml/templates"), alias="AI_SERVICE_TEMPLATE_DIR")
    storage_backend: str = Field(default="local", alias="AI_SERVICE_STORAGE_BACKEND")
    s3_bucket: str | None = Field(default=None, alias="AI_SERVICE_S3_BUCKET")
    s3_access_key_id: str | None = Field(default=None, alias="AI_SERVICE_S3_ACCESS_KEY_ID")
    s3_secret_access_key: str | None = Field(default=None, alias="AI_SERVICE_S3_SECRET_ACCESS_KEY")
    s3_endpoint_url: str | None = Field(default=None, alias="AI_SERVICE_S3_ENDPOINT_URL")
    s3_region: str = Field(default="us-east-1", alias="AI_SERVICE_S3_REGION")

    auth_disabled: bool = Field(default=True, alias="AI_SERVICE_DISABLE_AUTH")
    bearer_token: str | None = Field(default=None, alias="AI_SERVICE_BEARER_TOKEN")

    rate_limit_per_minute: int = Field(default=120, alias="AI_SERVICE_RATE_LIMIT_PER_MINUTE")
    inline_async_jobs: bool = Field(default=True, alias="AI_SERVICE_INLINE_ASYNC_JOBS")
    async_source_threshold: int = Field(default=5, alias="AI_SERVICE_ASYNC_SOURCE_THRESHOLD")
    async_slide_threshold: int = Field(default=10, alias="AI_SERVICE_ASYNC_SLIDE_THRESHOLD")
    async_duration_minutes_threshold: int = Field(default=10, alias="AI_SERVICE_ASYNC_DURATION_MINUTES_THRESHOLD")
    max_json_body_bytes: int = Field(default=2_097_152, alias="AI_SERVICE_MAX_JSON_BODY_BYTES", ge=1)
    max_upload_bytes: int = Field(default=268_435_456, alias="AI_SERVICE_MAX_UPLOAD_BYTES", ge=1)
    max_audio_duration_seconds: int = Field(default=7_200, alias="AI_SERVICE_MAX_AUDIO_DURATION_SECONDS", ge=1)
    max_video_duration_seconds: int = Field(default=10_800, alias="AI_SERVICE_MAX_VIDEO_DURATION_SECONDS", ge=1)

    request_timeout_seconds: float = Field(default=30.0, alias="AI_SERVICE_REQUEST_TIMEOUT_SECONDS")
    webhook_retry_attempts: int = Field(default=3, alias="AI_SERVICE_WEBHOOK_RETRY_ATTEMPTS", ge=1)
    webhook_backoff_seconds: float = Field(default=1.0, alias="AI_SERVICE_WEBHOOK_BACKOFF_SECONDS", ge=0.0)
    ffmpeg_binary: str = Field(default="ffmpeg", alias="FFMPEG_BINARY")
    ffprobe_binary: str = Field(default="ffprobe", alias="FFPROBE_BINARY")
    libreoffice_binary: str = Field(default="libreoffice", alias="LIBREOFFICE_BINARY")

    allow_stub_generators: bool = Field(default=False, alias="AI_SERVICE_ALLOW_STUB_GENERATORS")

    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_MODEL")
    gemini_embed_model: str = Field(default="gemini-embedding-001", alias="GEMINI_EMBED_MODEL")

    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_chat_model: str = Field(default="llama3.2", alias="OLLAMA_CHAT_MODEL")
    ollama_embed_model: str = Field(default="nomic-embed-text", alias="OLLAMA_EMBED_MODEL")

    openai_compatible_base_url: str | None = Field(default=None, alias="CENTRINVEST_LLM_URL")
    openai_compatible_api_key: str | None = Field(default=None, alias="CENTRINVEST_API_KEY")
    openai_compatible_model: str = Field(default="gpt-oss-20b", alias="CENTRINVEST_LLM_MODEL")
    openai_compatible_embeddings_url: str | None = Field(default=None, alias="CENTRINVEST_EMBEDDING_URL")
    openai_compatible_embed_model: str = Field(default="Qwen3-Embedding-0.6B", alias="CENTRINVEST_EMBED_MODEL")
    openai_compatible_stt_url: str | None = Field(default=None, alias="CENTRINVEST_STT_URL")
    openai_compatible_stt_model: str = Field(default="whisper-large-v3-turbo", alias="CENTRINVEST_STT_MODEL")

    embedding_dimensions: int = Field(default=1024, alias="EMBEDDING_DIMENSIONS")

    whisper_model_size: str = Field(default="small", alias="AI_SERVICE_WHISPER_MODEL_SIZE")
    whisper_device: str = Field(default="auto", alias="AI_SERVICE_WHISPER_DEVICE")
    whisper_compute_type: str = Field(default="int8", alias="AI_SERVICE_WHISPER_COMPUTE_TYPE")

    piper_binary: str = Field(default="piper", alias="PIPER_BINARY")
    piper_default_voice: str | None = Field(default=None, alias="PIPER_DEFAULT_VOICE")
    edge_tts_voice: str = Field(default="en-US-AriaNeural", alias="EDGE_TTS_VOICE")

    default_audio_sample_rate: int = 22050
    default_audio_channels: int = 1

    @computed_field
    @property
    def resolved_database_url(self) -> str:
        return resolve_database_url(self.database_url or self.fallback_database_url)

    @computed_field
    @property
    def resolved_db_schema(self) -> str | None:
        return resolve_db_schema(self.db_schema, self.database_url or self.fallback_database_url)

    @computed_field
    @property
    def resolved_redis_url(self) -> str:
        if self.redis_url:
            return self.redis_url
        password = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{password}{self.redis_host}:{self.redis_port}/0"

    @computed_field
    @property
    def repo_root(self) -> Path:
        return discover_repo_root(Path(__file__))

    @computed_field
    @property
    def openapi_spec_path(self) -> Path:
        return self.repo_root / "ai-service-openapi.yaml"

    @computed_field
    @property
    def templates_path(self) -> Path:
        path = self.template_dir
        if not path.is_absolute():
            path = self.repo_root / path
        return path

    @computed_field
    @property
    def artifacts_path(self) -> Path:
        path = self.artifact_root
        if not path.is_absolute():
            path = self.repo_root / path
        return path

    def is_development(self) -> bool:
        return self.environment.lower() in {"development", "dev", "local", "test", "testing"}

    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    def auth_is_disabled(self) -> bool:
        if self.is_production():
            return False
        return self.auth_disabled or (self.is_development() and not self.bearer_token)

    def model_aliases(self) -> dict[str, dict[str, Any]]:
        return {
            "text-default": {"provider": "gemini", "model": self.gemini_model, "modality": "text"},
            "text-local": {"provider": "ollama", "model": self.ollama_chat_model, "modality": "text"},
            "embed-default": {
                "provider": "gemini",
                "model": self.gemini_embed_model,
                "modality": "embeddings",
                "dimensions": self.embedding_dimensions,
            },
            "embedding-default": {
                "provider": "gemini",
                "model": self.gemini_embed_model,
                "modality": "embeddings",
                "dimensions": self.embedding_dimensions,
            },
            "embed-local": {
                "provider": "ollama",
                "model": self.ollama_embed_model,
                "modality": "embeddings",
                "dimensions": self.embedding_dimensions,
            },
            "stt-default": {"provider": "local_stt", "model": self.whisper_model_size, "modality": "audio"},
            "stt-local": {"provider": "local_stt", "model": self.whisper_model_size, "modality": "audio"},
            "tts-default": {
                "provider": "piper",
                "model": self.piper_default_voice or "default",
                "modality": "audio",
            },
            "tts-local": {
                "provider": "piper",
                "model": self.piper_default_voice or "default",
                "modality": "audio",
            },
            "render-default": {"provider": "local_render", "model": "ffmpeg", "modality": "video"},
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
