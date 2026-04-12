from __future__ import annotations

import asyncio
import copy
import json
import tempfile
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml_service.core.config import Settings, get_settings
from ml_service.core.errors import JobCancelledError, LimitExceededError, MediaValidationError
from ml_service.core.logging import get_logger
from ml_service.core.request_context import get_request_id, job_id_var, route_path_var
from ml_service.db.models import Artifact, Job, Project
from ml_service.pipelines.media import (
    build_srt,
    convert_with_libreoffice,
    create_cover_image,
    create_docx,
    create_text_pdf,
    dataframe_to_csv_bytes,
    dataframe_to_xlsx_bytes,
    ffmpeg_concat_audio,
    ffmpeg_concat_video,
    ffmpeg_convert,
    ffmpeg_render_audiogram,
    ffmpeg_render_slide_segment,
    infographic_to_image_bytes,
    presentation_to_html,
    presentation_to_pptx,
    probe_media_duration_seconds,
    render_slide_image,
)
from ml_service.providers.base import UnsupportedCapabilityError
from ml_service.providers.manager import ProviderManager
from ml_service.services.generation import SchemaGenerationService
from ml_service.services.heuristics import (
    build_chat_rag,
    build_compare,
    build_infographic,
    build_mindmap,
    build_podcast_payload,
    build_presentation_payload,
    build_quiz,
    build_report,
    build_rows_markdown,
    build_table,
    build_video_payload,
    estimate_audio_duration_ms,
    fallback_topic,
    regenerate_slide_content,
    summarize_text,
)
from ml_service.storage import ArtifactStorage, checksum_bytes


HEAVY_FORMATS = {"mp4", "mp3", "wav", "pptx", "pdf", "svg", "png"}
AUDIO_FILE_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".webm"}
VIDEO_FILE_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
logger = get_logger(__name__)


class PlatformService:
    def __init__(
        self,
        *,
        session: AsyncSession,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        provider_manager: ProviderManager,
        storage: ArtifactStorage,
    ) -> None:
        self.session = session
        self.session_factory = session_factory
        self.settings = settings
        self.provider_manager = provider_manager
        self.storage = storage
        self.generation_service = SchemaGenerationService(settings, provider_manager)

    def _log_limit_rejection(
        self,
        *,
        route: str,
        reason: str,
        details: dict[str, Any],
        job_id: str | None = None,
    ) -> None:
        logger.info(
            "Request rejected",
            extra={
                "extra_payload": {
                    "route": route,
                    "reason": reason,
                    "job_id": job_id,
                    "details": details,
                }
            },
        )

    async def _job_checkpoint(self, job_id: str | None, operation: str) -> None:
        if not job_id:
            return
        job = await self.session.get(Job, job_id, populate_existing=True)
        if job is None:
            return
        if job.status == "cancelled":
            logger.info(
                "Job cancelled",
                extra={
                    "extra_payload": {
                        "job_id": job_id,
                        "route": job.type,
                        "reason": "cancelled",
                        "status": job.status,
                        "operation": operation,
                    }
                },
            )
            raise JobCancelledError(job_id, operation)

    def _estimated_speech_duration_ms(self, payload: dict[str, Any]) -> int:
        segments = payload.get("segments") or []
        if segments:
            return sum(estimate_audio_duration_ms(str(segment.get("text") or "")) for segment in segments)
        return estimate_audio_duration_ms(str(payload.get("text") or ""))

    def _estimated_podcast_duration_ms(self, segments: list[dict[str, Any]]) -> int:
        return sum(int(segment.get("duration_estimate_ms") or estimate_audio_duration_ms(str(segment.get("text") or ""))) for segment in segments)

    def _estimated_video_duration_ms(self, scenes: list[dict[str, Any]]) -> int:
        return sum(int(scene.get("duration_ms") or estimate_audio_duration_ms(str(scene.get("narration_text") or scene.get("subtitle_text") or scene.get("title") or ""))) for scene in scenes)

    def _validate_duration_limit(
        self,
        duration_seconds: float,
        *,
        max_seconds: int,
        limit_name: str,
        route: str,
        job_id: str | None = None,
    ) -> None:
        if duration_seconds <= max_seconds:
            return
        details = {
            "limit_name": limit_name,
            "duration_seconds": round(duration_seconds, 3),
            "max_seconds": max_seconds,
        }
        self._log_limit_rejection(route=route, reason=limit_name, details=details, job_id=job_id)
        raise MediaValidationError(f"Media duration exceeds the configured {limit_name} limit.", code="invalid_media", details=details)

    def _validate_generated_audio_duration_ms(self, duration_ms: int, *, route: str, job_id: str | None = None) -> None:
        self._validate_duration_limit(
            max(duration_ms, 0) / 1000,
            max_seconds=self.settings.max_audio_duration_seconds,
            limit_name="audio_duration_seconds",
            route=route,
            job_id=job_id,
        )

    def _validate_generated_video_duration_ms(self, duration_ms: int, *, route: str, job_id: str | None = None) -> None:
        self._validate_duration_limit(
            max(duration_ms, 0) / 1000,
            max_seconds=self.settings.max_video_duration_seconds,
            limit_name="video_duration_seconds",
            route=route,
            job_id=job_id,
        )

    def _validate_upload_size(self, payload: bytes, *, filename: str, route: str) -> None:
        size_bytes = len(payload)
        if size_bytes <= self.settings.max_upload_bytes:
            return
        details = {
            "limit_name": "upload_bytes",
            "filename": filename,
            "size_bytes": size_bytes,
            "max_bytes": self.settings.max_upload_bytes,
        }
        self._log_limit_rejection(route=route, reason="upload_too_large", details=details)
        raise LimitExceededError("Multipart upload exceeds the configured limit.", details=details)

    def _validate_uploaded_media_duration(self, source_path: Path, *, route: str) -> None:
        duration_seconds = probe_media_duration_seconds(self.settings, source_path)
        if duration_seconds is None:
            return
        suffix = source_path.suffix.lower()
        if suffix in VIDEO_FILE_EXTENSIONS:
            self._validate_duration_limit(
                duration_seconds,
                max_seconds=self.settings.max_video_duration_seconds,
                limit_name="video_duration_seconds",
                route=route,
            )
            return
        self._validate_duration_limit(
            duration_seconds,
            max_seconds=self.settings.max_audio_duration_seconds,
            limit_name="audio_duration_seconds",
            route=route,
        )

    async def _validate_project_export_limits(
        self,
        project: Project,
        formats: list[str],
        *,
        job_id: str | None = None,
    ) -> None:
        payload = project.payload or {}
        if project.project_type == "presentation_project" and "mp4" in formats:
            duration_ms = sum(
                estimate_audio_duration_ms(str(slide.get("speaker_notes") or slide.get("title") or ""))
                for slide in payload.get("slides") or []
            )
            self._validate_generated_video_duration_ms(duration_ms, route="export.project.presentation_mp4", job_id=job_id)
            return
        if project.project_type == "podcast_project":
            segments = payload.get("segments") or []
            duration_ms = self._estimated_podcast_duration_ms(segments)
            if any(output_format in formats for output_format in {"wav", "mp3", "srt"}):
                self._validate_generated_audio_duration_ms(duration_ms, route="export.project.podcast_audio", job_id=job_id)
            if "mp4" in formats:
                self._validate_generated_video_duration_ms(duration_ms, route="export.project.podcast_mp4", job_id=job_id)
            return
        if project.project_type == "video_project" and any(output_format in formats for output_format in {"mp3", "mp4"}):
            scenes = copy.deepcopy(payload.get("scenes") or [])
            if not scenes and project.metadata_json.get("source_project_id"):
                scenes = await self._seed_video_scenes_from_source(
                    payload.get("mode", "scene_based_explainer"),
                    project.metadata_json["source_project_id"],
                    payload=payload,
                )
            duration_ms = self._estimated_video_duration_ms(scenes)
            if "mp3" in formats:
                self._validate_generated_audio_duration_ms(duration_ms, route="export.project.video_audio", job_id=job_id)
            if "mp4" in formats:
                self._validate_generated_video_duration_ms(duration_ms, route="export.project.video_mp4", job_id=job_id)

    async def list_providers(self) -> dict[str, Any]:
        return {"data": self.provider_manager.providers_catalog()}

    async def list_models(self) -> dict[str, Any]:
        return {"data": self.provider_manager.model_catalog()}

    async def create_chat_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        messages = self._normalized_messages(payload.get("messages") or [])
        result = await self.provider_manager.chat(
            messages,
            provider=payload.get("provider", "auto"),
            model_alias=payload.get("model", "text-default"),
            options=payload,
        )
        content = result.text
        response_format = payload.get("response_format") or {}
        if response_format.get("type") == "json_schema":
            structured = self.generation_service.coerce_to_schema(
                self.generation_service.parse_possible_json(content),
                response_format.get("json_schema") or {},
                self._stringify_messages(messages),
            )
            content = json.dumps(structured, ensure_ascii=True)
        return {
            "id": self._make_id("chatcmpl"),
            "object": "chat.completion",
            "created": int(datetime.now(UTC).timestamp()),
            "model": result.model,
            "provider": result.provider,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": result.usage,
        }

    async def stream_chat_completion(self, payload: dict[str, Any]) -> AsyncIterator[str]:
        completion_id = self._make_id("chatcmpl")
        if (payload.get("response_format") or {}).get("type") == "json_schema":
            response = await self.create_chat_completion({**payload, "stream": False})
            content = str(response["choices"][0]["message"]["content"])
            for token in content.split():
                yield json.dumps(
                    {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": int(datetime.now(UTC).timestamp()),
                        "model": payload.get("model", "text-default"),
                        "choices": [{"index": 0, "delta": {"content": token + " "}, "finish_reason": None}],
                    }
                )
            yield "[DONE]"
            return
        messages = self._normalized_messages(payload.get("messages") or [])
        async for chunk in self.provider_manager.stream_chat(
            messages,
            provider=payload.get("provider", "auto"),
            model_alias=payload.get("model", "text-default"),
            options=payload,
        ):
            yield json.dumps(
                {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": int(datetime.now(UTC).timestamp()),
                    "model": payload.get("model", "text-default"),
                    "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
                }
            )
        yield "[DONE]"

    async def create_embeddings(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_input = payload.get("input")
        items = raw_input if isinstance(raw_input, list) else [raw_input]
        embeddings = await self.provider_manager.embeddings(
            [str(item or "") for item in items],
            provider=payload.get("provider", "auto"),
            model_alias=payload.get("model", "embed-default"),
            task_type=payload.get("task_type"),
            dimensions=payload.get("dimensions"),
        )
        dimensions = int(payload.get("dimensions") or self.settings.embedding_dimensions)
        data = []
        for index, vector in enumerate(embeddings.vectors):
            normalized = vector[:dimensions] + [0.0] * max(0, dimensions - len(vector))
            data.append({"object": "embedding", "index": index, "embedding": normalized})
        return {
            "object": "list",
            "data": data,
            "model": embeddings.model,
            "provider": embeddings.provider,
            "usage": embeddings.usage,
        }

    async def transcribe_upload(self, upload: UploadFile, form_data: dict[str, Any]) -> dict[str, Any]:
        upload_bytes = await upload.read()
        self._validate_upload_size(
            upload_bytes,
            filename=upload.filename or "audio",
            route="/v1/audio/transcriptions",
        )
        suffix = Path(upload.filename or "audio").suffix or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            handle.write(upload_bytes)
            temp_path = Path(handle.name)
        try:
            self._validate_uploaded_media_duration(temp_path, route="/v1/audio/transcriptions")
            result = await self.provider_manager.transcribe(
                temp_path,
                provider=form_data.get("provider", "auto"),
                language=form_data.get("language"),
                diarization=bool(form_data.get("diarization", False)),
                word_timestamps="word" in (form_data.get("timestamp_granularities") or []),
            )
            response_format = form_data.get("response_format", "verbose_json")
            text_output = result.text
            segments = result.segments if response_format == "verbose_json" else []
            if response_format == "srt":
                text_output = build_srt(result.segments)
            if response_format in {"json", "text"}:
                segments = []
            return {
                "text": text_output,
                "language": result.language,
                "duration_ms": result.duration_ms,
                "segments": segments,
            }
        finally:
            temp_path.unlink(missing_ok=True)

    async def create_speech(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        self._ensure_speech_capabilities(payload)
        self._validate_generated_audio_duration_ms(
            self._estimated_speech_duration_ms(payload),
            route="/v1/audio/speech",
        )
        execution = payload.get("execution") or {}
        if self._should_async("speech.synthesis", execution, payload):
            job = await self._create_job("speech.synthesis", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = await self._run_speech(payload)
        return status.HTTP_200_OK, response

    async def run_chat_rag(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("chat_rag", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.chat_rag", execution, payload):
            job = await self._create_job("task.chat_rag", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        sources = (payload.get("sources") or [])[: payload.get("max_sources") or len(payload.get("sources") or [])]
        response = build_chat_rag(payload.get("messages") or [], sources, payload.get("answer_style") or payload.get("style_preset"))
        try:
            provider_result = await self.provider_manager.chat(
                self._build_chat_rag_messages(payload, sources, template),
                provider=(payload.get("generation") or {}).get("provider", "auto"),
                model_alias=(payload.get("generation") or {}).get("model", "text-default"),
                options=self._merge_generation_options(payload),
            )
            response["answer"] = provider_result.text or response["answer"]
            response["provider"] = provider_result.provider
            response["model"] = provider_result.model
            response["usage"] = provider_result.usage
        except Exception:  # noqa: BLE001
            if not self.settings.allow_stub_generators:
                raise
            response["provider"] = "heuristic"
            response["model"] = "heuristic"
            response["usage"] = {}
        response["citations"] = self._apply_citation_mode(
            response.get("answer", ""),
            response.get("citations") or [],
            payload.get("citation_mode", "separate"),
        )
        if payload.get("citation_mode") == "inline":
            response["answer"] = self._inline_citations(response["answer"], response["citations"])
        if payload.get("output_schema"):
            response["answer"] = json.dumps(
                self.generation_service.coerce_to_schema(
                    self.generation_service.parse_possible_json(response["answer"]),
                    payload["output_schema"],
                    response["answer"],
                ),
                ensure_ascii=True,
            )
        return status.HTTP_200_OK, response

    async def run_compare(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("compare", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.compare", execution, payload):
            job = await self._create_job("task.compare", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_compare(
            payload.get("documents") or [],
            payload.get("mode", "pairwise"),
            payload.get("focus_topics"),
        )
        response = await self._structured_task_response("compare", payload, response, template)
        return status.HTTP_200_OK, response

    async def run_mindmap(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("mindmap", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.mindmap", execution, payload):
            job = await self._create_job("task.mindmap", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_mindmap(
            payload.get("prompt"),
            payload.get("sources"),
            payload.get("max_depth"),
            payload.get("target_branch_count"),
            payload.get("target_children_per_branch"),
        )
        response = await self._structured_task_response("mindmap", payload, response, template)
        return status.HTTP_200_OK, response

    async def run_quiz(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("quiz", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.quiz", execution, payload):
            job = await self._create_job("task.quiz", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_quiz(payload)
        response = await self._structured_task_response("quiz", payload, response, template)
        return status.HTTP_200_OK, response

    async def run_table(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("table", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.table", execution, payload):
            job = await self._create_job("task.table", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_table(payload)
        response = await self._structured_task_response("table", payload, response, template)
        output_format = payload.get("output_format", "json")
        if output_format != "json":
            artifacts = await self._export_table_artifacts(response["columns"], response["rows"], [output_format], None, None)
            response["artifacts"] = artifacts
        return status.HTTP_200_OK, response

    async def run_infographic(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("infographic", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.infographic", execution, payload):
            job = await self._create_job("task.infographic", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_infographic(payload)
        response = await self._structured_task_response("infographic", payload, response, template)
        render_formats = payload.get("render_formats") or []
        if render_formats:
            artifacts = await self._export_infographic_artifacts(response["spec"], render_formats, None, None)
            response["artifacts"] = artifacts
        return status.HTTP_200_OK, response

    async def run_report(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("report", payload, template_id=payload.get("template_id"))
        execution = payload.get("execution") or {}
        if self._should_async("task.report", execution, payload):
            job = await self._create_job("task.report", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = build_report(payload)
        response = await self._structured_task_response("report", payload, response, template)
        output_formats = payload.get("output_formats") or []
        if output_formats:
            artifacts = await self._export_report_artifacts(response, output_formats, None, None)
            response["artifacts"] = artifacts
        return status.HTTP_200_OK, response

    async def run_presentation(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("presentation", payload, template_id=payload.get("template_id"))
        execution = payload.get("execution") or {}
        if self._should_async("task.presentation", execution, payload):
            job = await self._create_job("task.presentation", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        project_payload = build_presentation_payload(payload)
        project_payload = await self._structured_project_payload("presentation", payload, project_payload, template)
        project = await self._create_project_from_payload(
            project_type="presentation_project",
            title=fallback_topic(payload.get("prompt"), payload.get("sources")),
            template_id=payload.get("template_id"),
            metadata={"audience": payload.get("audience"), "tone": payload.get("tone"), "language": payload.get("language")},
            settings={"theme": payload.get("theme"), "layout_strategy": payload.get("layout_strategy")},
            payload=project_payload,
        )
        if payload.get("output_formats"):
            await self._run_export(project.id, payload["output_formats"], {"source": "task.presentation"})
        return status.HTTP_200_OK, {"project": await self.get_project(project.id)}

    async def run_podcast(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("podcast", payload, template_id=payload.get("template_id"))
        execution = payload.get("execution") or {}
        if self._should_async("task.podcast", execution, payload):
            job = await self._create_job("task.podcast", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        project_payload = build_podcast_payload(payload)
        project_payload = await self._structured_project_payload("podcast", payload, project_payload, template)
        project = await self._create_project_from_payload(
            project_type="podcast_project",
            title=fallback_topic(payload.get("prompt"), payload.get("sources")),
            template_id=payload.get("template_id"),
            metadata={"objective": payload.get("objective"), "audience": payload.get("audience")},
            settings={"duration_hint_minutes": payload.get("duration_hint_minutes")},
            payload=project_payload,
        )
        if payload.get("render_formats"):
            await self._run_export(project.id, payload["render_formats"], {"source": "task.podcast"})
        return status.HTTP_200_OK, {"project": await self.get_project(project.id)}

    async def run_video(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        payload, template = self._prepare_task_payload("video", payload)
        execution = payload.get("execution") or {}
        if self._should_async("task.video", execution, payload):
            job = await self._create_job("task.video", None, payload, idempotency_key=execution.get("idempotency_key"))
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        project_payload = await self._build_video_project_payload(payload)
        project_payload = await self._structured_project_payload("video", payload, project_payload, template)
        project = await self._create_project_from_payload(
            project_type="video_project",
            title=payload.get("title") or fallback_topic(None, payload.get("sources")),
            template_id=payload.get("template_id"),
            metadata={"caption_mode": payload.get("caption_mode"), "source_project_id": payload.get("source_project_id")},
            settings={"aspect_ratio": payload.get("aspect_ratio")},
            payload=project_payload,
        )
        return status.HTTP_200_OK, {"project": await self.get_project(project.id)}

    async def list_projects(
        self,
        *,
        project_type: str | None = None,
        status_filter: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        offset = self._parse_cursor(cursor)
        query = select(Project).order_by(Project.created_at.desc()).offset(offset).limit(limit + 1)
        if project_type:
            query = query.where(Project.project_type == project_type)
        if status_filter:
            query = query.where(Project.status == status_filter)
        rows = list((await self.session.execute(query)).scalars())
        data = [self._project_summary(project) for project in rows[:limit]]
        next_cursor = str(offset + limit) if len(rows) > limit else None
        return {"data": data, "next_cursor": next_cursor}

    async def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._create_project_from_payload(
            project_type=payload["project_type"],
            title=payload["title"],
            template_id=payload.get("template_id"),
            metadata=payload.get("metadata") or {},
            settings=payload.get("settings") or {},
            payload=self._default_payload(payload["project_type"], payload.get("content") or {}),
        )
        return await self.get_project(project.id)

    async def get_project(self, project_id: str) -> dict[str, Any]:
        project = await self._get_project_model(project_id)
        return await self._project_to_response(project)

    async def patch_project(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._get_project_model(project_id)
        if payload.get("title"):
            project.title = payload["title"]
        if payload.get("status"):
            project.status = payload["status"]
        if payload.get("metadata"):
            project.metadata_json = self._deep_merge(project.metadata_json, payload["metadata"])
        if payload.get("settings"):
            project.settings_json = self._deep_merge(project.settings_json, payload["settings"])
        if payload.get("content"):
            project.payload = self._deep_merge(project.payload, payload["content"])
        project.version += 1
        await self.session.commit()
        return await self.get_project(project_id)

    async def delete_project(self, project_id: str) -> None:
        project = await self._get_project_model(project_id)
        project.status = "archived"
        await self.session.commit()

    async def export_project(self, project_id: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        execution = payload.get("execution") or {}
        if self._should_async("export.project", execution, payload):
            job = await self._create_job(
                "export.project",
                project_id,
                payload,
                idempotency_key=execution.get("idempotency_key"),
            )
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        response = await self._run_export(project_id, payload.get("formats") or [], payload.get("render_options") or {})
        return status.HTTP_200_OK, response

    async def add_slide(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._get_project_model(project_id, expected_type="presentation_project")
        slides = copy.deepcopy(project.payload.get("slides") or [])
        slide = payload["slide"]
        after_slide_id = payload.get("after_slide_id")
        if after_slide_id:
            index = next((idx for idx, row in enumerate(slides) if row.get("id") == after_slide_id), len(slides))
            slides.insert(index + 1, slide)
        else:
            slides.append(slide)
        project.payload = {**(project.payload or {}), "slides": slides}
        project.version += 1
        await self.session.commit()
        return await self.get_project(project_id)

    async def update_slide(self, project_id: str, slide_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._get_project_model(project_id, expected_type="presentation_project")
        slides = copy.deepcopy(project.payload.get("slides") or [])
        index = self._find_index(slides, slide_id)
        slides[index] = self._deep_merge(slides[index], payload.get("slide_patch") or {})
        move_after = payload.get("move_after_slide_id")
        if move_after:
            slide = slides.pop(index)
            target_index = self._find_index(slides, move_after)
            slides.insert(target_index + 1, slide)
        project.payload = {**(project.payload or {}), "slides": slides}
        project.version += 1
        await self.session.commit()
        return await self.get_project(project_id)

    async def delete_slide(self, project_id: str, slide_id: str) -> None:
        project = await self._get_project_model(project_id, expected_type="presentation_project")
        slides = [slide for slide in project.payload.get("slides") or [] if slide.get("id") != slide_id]
        project.payload = {**(project.payload or {}), "slides": slides}
        project.version += 1
        await self.session.commit()

    async def regenerate_slide(self, project_id: str, slide_id: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        execution = payload.get("execution") or {}
        if self._should_async("presentation.regenerate_slide", execution, payload):
            job = await self._create_job(
                "presentation.regenerate_slide",
                project_id,
                {"slide_id": slide_id, **payload},
                idempotency_key=execution.get("idempotency_key"),
            )
            await self._enqueue_job(job.id)
            return status.HTTP_202_ACCEPTED, {"job": await self.get_job(job.id)}
        project = await self._get_project_model(project_id, expected_type="presentation_project")
        slides = copy.deepcopy(project.payload.get("slides") or [])
        index = self._find_index(slides, slide_id)
        slides[index] = regenerate_slide_content(slides[index], payload.get("instructions"), payload.get("fields"))
        project.payload = {**(project.payload or {}), "slides": slides}
        project.version += 1
        await self.session.commit()
        return status.HTTP_200_OK, await self.get_project(project_id)

    async def update_segment(self, project_id: str, segment_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._get_project_model(project_id, expected_type="podcast_project")
        segments = copy.deepcopy(project.payload.get("segments") or [])
        index = self._find_index(segments, segment_id)
        segments[index] = self._deep_merge(segments[index], payload)
        project.payload = {**(project.payload or {}), "segments": segments}
        project.version += 1
        await self.session.commit()
        return await self.get_project(project_id)

    async def rerender_segment(self, project_id: str, segment_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_segment_rerender_capabilities(payload)
        job = await self._create_job(
            "podcast.rerender_segment",
            project_id,
            {"segment_id": segment_id, **payload},
            idempotency_key=(payload.get("execution") or {}).get("idempotency_key"),
        )
        await self._enqueue_job(job.id)
        return {"job": await self.get_job(job.id)}

    async def update_scene(self, project_id: str, scene_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = await self._get_project_model(project_id, expected_type="video_project")
        scenes = copy.deepcopy(project.payload.get("scenes") or [])
        index = self._find_index(scenes, scene_id)
        scenes[index] = self._deep_merge(scenes[index], payload)
        project.payload = {**(project.payload or {}), "scenes": scenes}
        project.version += 1
        await self.session.commit()
        return await self.get_project(project_id)

    async def rerender_scene(self, project_id: str, scene_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        job = await self._create_job(
            "video.rerender_scene",
            project_id,
            {"scene_id": scene_id, **payload},
            idempotency_key=(payload.get("execution") or {}).get("idempotency_key"),
        )
        await self._enqueue_job(job.id)
        return {"job": await self.get_job(job.id)}

    async def list_jobs(
        self,
        *,
        job_type: str | None = None,
        status_filter: str | None = None,
        project_id: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        offset = self._parse_cursor(cursor)
        query = select(Job).order_by(Job.created_at.desc()).offset(offset).limit(limit + 1)
        if job_type:
            query = query.where(Job.type == job_type)
        if status_filter:
            query = query.where(Job.status == status_filter)
        if project_id:
            query = query.where(Job.project_id == project_id)
        rows = list((await self.session.execute(query)).scalars())
        data = [await self._job_to_response(job) for job in rows[:limit]]
        next_cursor = str(offset + limit) if len(rows) > limit else None
        return {"data": data, "next_cursor": next_cursor}

    async def get_job(self, job_id: str) -> dict[str, Any]:
        job = await self._get_job_model(job_id)
        return await self._job_to_response(job)

    async def cancel_job(self, job_id: str) -> dict[str, Any]:
        job = await self._get_job_model(job_id)
        if job.status in {"queued", "running"}:
            job.status = "cancelled"
            job.progress = 0
            await self.session.commit()
            logger.info(
                "Job cancelled",
                extra={
                    "extra_payload": {
                        "job_id": job.id,
                        "route": job.type,
                        "reason": "cancelled_by_user",
                        "status": job.status,
                    }
                },
            )
        return await self.get_job(job_id)

    async def list_artifacts(
        self,
        *,
        kind: str | None = None,
        project_id: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        offset = self._parse_cursor(cursor)
        query = select(Artifact).order_by(Artifact.created_at.desc()).offset(offset).limit(limit + 1)
        if kind:
            query = query.where(Artifact.kind == kind)
        if project_id:
            query = query.where(Artifact.project_id == project_id)
        rows = list((await self.session.execute(query)).scalars())
        data = [self._artifact_to_response(artifact) for artifact in rows[:limit]]
        next_cursor = str(offset + limit) if len(rows) > limit else None
        return {"data": data, "next_cursor": next_cursor}

    async def get_artifact(self, artifact_id: str) -> dict[str, Any]:
        artifact = await self._get_artifact_model(artifact_id)
        return self._artifact_to_response(artifact)

    async def download_artifact(self, artifact_id: str) -> tuple[str, str, bytes]:
        artifact = await self._get_artifact_model(artifact_id)
        payload = self._read_artifact_payload(artifact)
        return self._artifact_filename(artifact), artifact.mime_type, payload

    async def list_templates(self, kind: str | None = None, version: str | None = None) -> dict[str, Any]:
        rows = self._load_templates()
        if kind:
            rows = [row for row in rows if row.get("kind") == kind]
        if version:
            rows = [row for row in rows if row.get("version") == version]
        return {"data": rows}

    async def get_template(self, template_id: str) -> dict[str, Any]:
        for template in self._load_templates():
            if template["id"] == template_id:
                return template
        raise HTTPException(
            status_code=404,
            detail={"code": "template_not_found", "message": f"Template '{template_id}' not found.", "request_id": get_request_id()},
        )

    async def run_job(self, job_id: str) -> dict[str, Any]:
        job = await self._get_job_model(job_id)
        if job.status == "cancelled":
            return await self._job_to_response(job)
        job_token = job_id_var.set(job.id)
        route_token = route_path_var.set(job.type)
        job.status = "running"
        job.progress = 5
        await self.session.commit()
        try:
            await self._job_checkpoint(job.id, "job.dispatch")
            result_ref = await self._dispatch_job(job)
            await self._job_checkpoint(job.id, "job.finalize")
            job = await self._get_job_model(job.id)
            if job.status != "cancelled":
                job.status = "completed"
                job.progress = 100
                job.result_ref = result_ref
                await self.session.commit()
        except JobCancelledError:
            job = await self._get_job_model(job.id)
            job.status = "cancelled"
            job.error_json = None
            await self.session.commit()
        except Exception as error:  # noqa: BLE001
            job = await self._get_job_model(job.id)
            job.status = "failed"
            job.error_json = {"code": "job_failed", "message": str(error), "request_id": job.request_id}
            await self.session.commit()
        try:
            response = await self._job_to_response(job)
            logger.info(
                "Job finished",
                extra={
                    "extra_payload": {
                        "job_id": job.id,
                        "status": job.status,
                        "provider": job.provider,
                        "model": job.model,
                        "artifact_ids": [artifact["id"] for artifact in response.get("artifacts", [])],
                    }
                },
            )
            await self._notify_job_webhook(job, response)
            return response
        finally:
            route_path_var.reset(route_token)
            job_id_var.reset(job_token)

    async def _dispatch_job(self, job: Job) -> dict[str, Any]:
        if job.type == "speech.synthesis":
            response = await self._run_speech(job.input_ref, job_id=job.id)
            return {
                "artifacts": [artifact["id"] for artifact in response["artifacts"]],
                "provider": response.get("provider"),
                "model": response.get("model"),
            }
        if job.type == "task.chat_rag":
            _, result = await self.run_chat_rag(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.compare":
            _, result = await self.run_compare(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.mindmap":
            _, result = await self.run_mindmap(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.quiz":
            _, result = await self.run_quiz(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.table":
            _, result = await self.run_table(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.infographic":
            _, result = await self.run_infographic(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.report":
            _, result = await self.run_report(self._force_sync_execution(job.input_ref))
            return {"result": result}
        if job.type == "task.presentation":
            payload, template = self._prepare_task_payload("presentation", job.input_ref, template_id=job.input_ref.get("template_id"))
            project_payload = build_presentation_payload(payload)
            project_payload = await self._structured_project_payload("presentation", payload, project_payload, template)
            project = await self._create_project_from_payload(
                project_type="presentation_project",
                title=fallback_topic(payload.get("prompt"), payload.get("sources")),
                template_id=payload.get("template_id"),
                metadata={
                    "audience": payload.get("audience"),
                    "tone": payload.get("tone"),
                    "language": payload.get("language"),
                    "async_job_id": job.id,
                },
                settings={"theme": payload.get("theme"), "layout_strategy": payload.get("layout_strategy")},
                payload=project_payload,
            )
            if payload.get("output_formats"):
                await self._run_export(project.id, payload["output_formats"], {"source": "task.presentation"}, job.id)
            return {"project_id": project.id}
        if job.type == "task.podcast":
            payload, template = self._prepare_task_payload("podcast", job.input_ref, template_id=job.input_ref.get("template_id"))
            project_payload = build_podcast_payload(payload)
            project_payload = await self._structured_project_payload("podcast", payload, project_payload, template)
            project = await self._create_project_from_payload(
                project_type="podcast_project",
                title=fallback_topic(payload.get("prompt"), payload.get("sources")),
                template_id=payload.get("template_id"),
                metadata={"objective": payload.get("objective"), "audience": payload.get("audience"), "async_job_id": job.id},
                settings={"duration_hint_minutes": payload.get("duration_hint_minutes")},
                payload=project_payload,
            )
            if payload.get("render_formats"):
                await self._run_export(project.id, payload["render_formats"], {"source": "task.podcast"}, job.id)
            return {"project_id": project.id}
        if job.type == "task.video":
            payload, template = self._prepare_task_payload("video", job.input_ref)
            project_payload = await self._build_video_project_payload(payload)
            project_payload = await self._structured_project_payload("video", payload, project_payload, template)
            project = await self._create_project_from_payload(
                project_type="video_project",
                title=payload.get("title") or fallback_topic(None, payload.get("sources")),
                template_id=payload.get("template_id"),
                metadata={
                    "caption_mode": payload.get("caption_mode"),
                    "source_project_id": payload.get("source_project_id"),
                    "async_job_id": job.id,
                },
                settings={"aspect_ratio": payload.get("aspect_ratio")},
                payload=project_payload,
            )
            return {"project_id": project.id}
        if job.type == "export.project":
            return await self._run_export(
                job.project_id,
                job.input_ref.get("formats") or [],
                job.input_ref.get("render_options") or {},
                job.id,
            )
        if job.type == "presentation.regenerate_slide":
            await self.regenerate_slide(
                job.project_id,
                job.input_ref["slide_id"],
                self._force_sync_execution(job.input_ref),
            )
            return {"project_id": job.project_id}
        if job.type == "podcast.rerender_segment":
            artifact = await self._rerender_segment(job.project_id, job.input_ref["segment_id"], job.input_ref, job.id)
            return {"artifact_id": artifact["id"], "project_id": job.project_id}
        if job.type == "video.rerender_scene":
            artifact = await self._rerender_scene(job.project_id, job.input_ref["scene_id"], job.input_ref, job.id)
            return {"artifact_id": artifact["id"], "project_id": job.project_id}
        raise RuntimeError(f"Unsupported job type '{job.type}'.")

    async def _run_speech(self, payload: dict[str, Any], job_id: str | None = None) -> dict[str, Any]:
        self._ensure_speech_capabilities(payload)
        self._validate_generated_audio_duration_ms(
            self._estimated_speech_duration_ms(payload),
            route="/v1/audio/speech",
            job_id=job_id,
        )
        output_format = payload.get("output_format", "mp3")
        segments = payload.get("segments") or [{"id": "segment_1", "speaker": None, "text": payload.get("text") or "", "voice": payload.get("voice")}]
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            audio_paths: list[Path] = []
            synthesized_segments: list[dict[str, Any]] = []
            response_segments: list[dict[str, Any]] = []
            provider = None
            model = None
            current_start = 0
            for index, segment in enumerate(segments, start=1):
                await self._job_checkpoint(job_id, f"speech.segment.{index}.before_synthesize")
                result = await self.provider_manager.synthesize(
                    str(segment.get("text") or ""),
                    provider=payload.get("provider", "auto"),
                    voice_id=(segment.get("voice") or payload.get("voice") or {}).get("voice_id"),
                    output_format=output_format,
                    speaking_rate=float(payload.get("speaking_rate", 1.0)),
                )
                await self._job_checkpoint(job_id, f"speech.segment.{index}.after_synthesize")
                provider = provider or result.provider
                model = model or result.model
                suffix = ".wav" if result.mime_type == "audio/wav" else ".mp3"
                path = temp_dir / f"segment_{index}{suffix}"
                path.write_bytes(result.payload)
                audio_paths.append(path)
                duration_ms = result.duration_ms or estimate_audio_duration_ms(str(segment.get("text") or ""))
                synthesized_segments.append(
                    {
                        "id": segment.get("id") or f"segment_{index}",
                        "speaker": segment.get("speaker"),
                        "text": segment.get("text"),
                        "ssml": segment.get("ssml"),
                        "voice": segment.get("voice") or payload.get("voice"),
                        "start_ms": current_start,
                        "end_ms": current_start + duration_ms,
                    }
                )
                response_segments.append(
                    {
                        "id": segment.get("id") or f"segment_{index}",
                        "speaker": segment.get("speaker"),
                        "text": segment.get("text") or "",
                        "ssml": segment.get("ssml"),
                        "voice": segment.get("voice") or payload.get("voice"),
                    }
                )
                current_start += duration_ms
            final_path = temp_dir / f"speech{'.wav' if output_format == 'wav' else '.mp3'}"
            if len(audio_paths) == 1:
                final_path.write_bytes(audio_paths[0].read_bytes())
            else:
                await self._job_checkpoint(job_id, "speech.concat.before")
                ffmpeg_concat_audio(self.settings, audio_paths, final_path)
                await self._job_checkpoint(job_id, "speech.concat.after")
                if output_format == "wav" and final_path.suffix != ".wav":
                    converted = temp_dir / "speech.wav"
                    ffmpeg_convert(self.settings, final_path, converted)
                    final_path = converted
            artifacts = []
            audio_artifact = await self._persist_file_artifact(
                kind="audio_wav" if output_format == "wav" else "audio_mp3",
                mime_type="audio/wav" if output_format == "wav" else "audio/mpeg",
                source_path=final_path,
                project_id=None,
                job_id=job_id,
            )
            artifacts.append(audio_artifact)
            segments_artifact = await self._persist_text_artifact(
                kind="json",
                mime_type="application/json",
                content=json.dumps(synthesized_segments, ensure_ascii=True, indent=2),
                extension=".json",
                project_id=None,
                job_id=job_id,
            )
            artifacts.append(segments_artifact)
            chapters = self._build_chapters_from_segments(synthesized_segments)
            chapters_artifact = await self._persist_text_artifact(
                kind="json",
                mime_type="application/json",
                content=json.dumps(chapters, ensure_ascii=True, indent=2),
                extension=".json",
                project_id=None,
                job_id=job_id,
            )
            artifacts.append(chapters_artifact)
            srt_artifact = await self._persist_text_artifact(
                kind="subtitle_srt",
                mime_type="application/x-subrip",
                content=build_srt(synthesized_segments),
                extension=".srt",
                project_id=None,
                job_id=job_id,
            )
            artifacts.append(srt_artifact)
            return {
                "provider": provider or payload.get("provider", "auto"),
                "model": model or payload.get("model", "tts-default"),
                "duration_ms": synthesized_segments[-1]["end_ms"] if synthesized_segments else 0,
                "artifacts": artifacts,
                "segments": response_segments,
            }

    async def _run_export(
        self,
        project_id: str,
        formats: list[str],
        render_options: dict[str, Any],
        job_id: str | None = None,
    ) -> dict[str, Any]:
        await self._job_checkpoint(job_id, "export.before_load")
        project = await self._get_project_model(project_id)
        await self._validate_project_export_limits(project, formats, job_id=job_id)
        payload = project.payload
        artifacts: list[dict[str, Any]] = []
        if project.project_type == "presentation_project":
            artifacts.extend(await self._export_presentation(project, formats, render_options, job_id))
        elif project.project_type == "podcast_project":
            artifacts.extend(await self._export_podcast(project, formats, render_options, job_id))
        elif project.project_type == "video_project":
            artifacts.extend(await self._export_video(project, formats, render_options, job_id))
        else:
            if "json" in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        kind="json",
                        mime_type="application/json",
                        content=json.dumps(payload, ensure_ascii=True, indent=2),
                        extension=".json",
                        project_id=project.id,
                        job_id=job_id,
                    )
                )
        await self._job_checkpoint(job_id, "export.after_generate")
        project.status = "ready"
        await self.session.commit()
        return {"project_id": project.id, "artifacts": artifacts}

    async def _export_presentation(
        self,
        project: Project,
        formats: list[str],
        render_options: dict[str, Any],
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        del render_options
        artifacts: list[dict[str, Any]] = []
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            pptx_path = temp_dir / f"{project.id}.pptx"
            html_path = temp_dir / f"{project.id}.html"
            project_response = await self._project_to_response(project)
            await self._job_checkpoint(job_id, "presentation_export.before_generate")
            presentation_to_pptx(project_response, pptx_path)
            html_content = presentation_to_html(project_response)
            html_path.write_text(html_content, encoding="utf-8")
            await self._job_checkpoint(job_id, "presentation_export.after_generate")
            if "pptx" in formats:
                artifacts.append(
                    await self._persist_file_artifact("presentation_pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx_path, project.id, job_id)
                )
            if "html" in formats:
                artifacts.append(
                    await self._persist_text_artifact("text", "text/html", html_content, ".html", project.id, job_id)
                )
            if "pdf" in formats:
                pdf_bytes = convert_with_libreoffice(self.settings, pptx_path, ".pdf")
                if pdf_bytes is None:
                    sections = [(slide.get("title", ""), summarize_text(json.dumps(slide, ensure_ascii=True), 2)) for slide in (project.payload.get("slides") or [])]
                    pdf_bytes = create_text_pdf(project.title, sections)
                artifacts.append(
                    await self._persist_bytes_artifact("presentation_pdf", "application/pdf", pdf_bytes, ".pdf", project.id, job_id)
                )
            if "mp4" in formats:
                artifacts.extend(await self._export_presentation_video(project, temp_dir, job_id))
        return artifacts

    async def _export_presentation_video(
        self,
        project: Project,
        temp_dir: Path,
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = []
        segments = []
        video_segments: list[Path] = []
        slides = project.payload.get("slides") or []
        self._validate_generated_video_duration_ms(
            sum(estimate_audio_duration_ms(str(slide.get("speaker_notes") or slide.get("title") or "")) for slide in slides),
            route="export.project.presentation_mp4",
            job_id=job_id,
        )
        for index, slide in enumerate(slides, start=1):
            await self._job_checkpoint(job_id, f"presentation_video.slide.{index}.before_render")
            image_path = temp_dir / f"slide_{index}.png"
            render_slide_image(slide, image_path)
            notes = str(slide.get("speaker_notes") or slide.get("title") or "")
            synthesis = await self.provider_manager.synthesize(notes, provider="auto", output_format="mp3", speaking_rate=1.0)
            await self._job_checkpoint(job_id, f"presentation_video.slide.{index}.after_synthesize")
            audio_path = temp_dir / f"slide_{index}.mp3"
            audio_path.write_bytes(synthesis.payload)
            duration_ms = synthesis.duration_ms or estimate_audio_duration_ms(notes)
            segment_path = temp_dir / f"slide_{index}.mp4"
            ffmpeg_render_slide_segment(self.settings, image_path, audio_path, segment_path)
            await self._job_checkpoint(job_id, f"presentation_video.slide.{index}.after_render")
            video_segments.append(segment_path)
            start_ms = segments[-1]["end_ms"] if segments else 0
            segments.append({"id": f"slide_{index}", "start_ms": start_ms, "end_ms": start_ms + duration_ms, "text": notes})
        await self._job_checkpoint(job_id, "presentation_video.concat.before")
        final_video = temp_dir / f"{project.id}.mp4"
        ffmpeg_concat_video(self.settings, video_segments, final_video)
        await self._job_checkpoint(job_id, "presentation_video.concat.after")
        artifacts.append(await self._persist_file_artifact("video_mp4", "video/mp4", final_video, project.id, job_id))
        artifacts.append(
            await self._persist_text_artifact(
                "subtitle_srt",
                "application/x-subrip",
                build_srt(segments),
                ".srt",
                project.id,
                job_id,
            )
        )
        return artifacts

    async def _export_podcast(
        self,
        project: Project,
        formats: list[str],
        render_options: dict[str, Any],
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        del render_options
        artifacts: list[dict[str, Any]] = []
        requires_audio_render = any(output_format in formats for output_format in {"wav", "mp3", "srt", "mp4"})
        segments = copy.deepcopy(project.payload.get("segments") or [])
        if requires_audio_render:
            self._validate_generated_audio_duration_ms(
                self._estimated_podcast_duration_ms(segments),
                route="export.project.podcast_audio",
                job_id=job_id,
            )
        if "mp4" in formats:
            self._validate_generated_video_duration_ms(
                self._estimated_podcast_duration_ms(segments),
                route="export.project.podcast_mp4",
                job_id=job_id,
            )
        if not requires_audio_render:
            if "json" in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        "json",
                        "application/json",
                        json.dumps(await self._project_to_response(project), ensure_ascii=True, indent=2),
                        ".json",
                        project.id,
                        job_id,
                    )
                )
            return artifacts
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            rendered_segments = []
            audio_paths: list[Path] = []
            current_start = 0
            for index, segment in enumerate(segments, start=1):
                text = str(segment.get("text") or "")
                voice = segment.get("voice") or (project.payload.get("voice_map") or {}).get(segment.get("speaker") or "", {})
                await self._job_checkpoint(job_id, f"podcast_export.segment.{index}.before_synthesize")
                result = await self.provider_manager.synthesize(
                    text,
                    provider="auto",
                    voice_id=(voice or {}).get("voice_id"),
                    output_format="wav",
                    speaking_rate=1.0,
                )
                await self._job_checkpoint(job_id, f"podcast_export.segment.{index}.after_synthesize")
                audio_path = temp_dir / f"{segment['id']}.wav"
                audio_path.write_bytes(result.payload)
                audio_paths.append(audio_path)
                duration_ms = result.duration_ms or estimate_audio_duration_ms(text)
                segment["audio_artifact_id"] = None
                segment["voice"] = voice or segment.get("voice")
                segment["start_ms"] = current_start
                segment["end_ms"] = current_start + duration_ms
                segment["status"] = "voiced"
                current_start += duration_ms
                rendered_segments.append(segment)
            await self._job_checkpoint(job_id, "podcast_export.concat.before")
            wav_path = temp_dir / f"{project.id}.wav"
            ffmpeg_concat_audio(self.settings, audio_paths, wav_path)
            await self._job_checkpoint(job_id, "podcast_export.concat.after")
            if "wav" in formats:
                artifacts.append(await self._persist_file_artifact("audio_wav", "audio/wav", wav_path, project.id, job_id))
            if "mp3" in formats or "mp4" in formats:
                await self._job_checkpoint(job_id, "podcast_export.convert_mp3.before")
                mp3_path = temp_dir / f"{project.id}.mp3"
                ffmpeg_convert(self.settings, wav_path, mp3_path)
                await self._job_checkpoint(job_id, "podcast_export.convert_mp3.after")
                if "mp3" in formats:
                    artifacts.append(await self._persist_file_artifact("audio_mp3", "audio/mpeg", mp3_path, project.id, job_id))
            if "srt" in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        "subtitle_srt",
                        "application/x-subrip",
                        build_srt(rendered_segments),
                        ".srt",
                        project.id,
                        job_id,
                    )
                )
            if "json" in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        "json",
                        "application/json",
                        json.dumps(await self._project_to_response(project), ensure_ascii=True, indent=2),
                        ".json",
                        project.id,
                        job_id,
                    )
                )
            if "mp4" in formats:
                await self._job_checkpoint(job_id, "podcast_export.audiogram.before")
                cover_path = temp_dir / "cover.png"
                create_cover_image(project.title, cover_path)
                mp3_source = temp_dir / f"{project.id}.mp3"
                if not mp3_source.exists():
                    ffmpeg_convert(self.settings, wav_path, mp3_source)
                mp4_path = temp_dir / f"{project.id}.mp4"
                ffmpeg_render_audiogram(self.settings, mp3_source, mp4_path, cover_path)
                await self._job_checkpoint(job_id, "podcast_export.audiogram.after")
                artifacts.append(await self._persist_file_artifact("video_mp4", "video/mp4", mp4_path, project.id, job_id))
        project.payload = {**(project.payload or {}), "segments": rendered_segments}
        return artifacts

    async def _export_video(
        self,
        project: Project,
        formats: list[str],
        render_options: dict[str, Any],
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        del render_options
        artifacts: list[dict[str, Any]] = []
        if "json" in formats:
            artifacts.append(
                await self._persist_text_artifact(
                    "json",
                    "application/json",
                    json.dumps(await self._project_to_response(project), ensure_ascii=True, indent=2),
                    ".json",
                    project.id,
                    job_id,
                )
            )
        mode = project.payload.get("mode", "scene_based_explainer")
        if mode == "audiogram":
            if not any(fmt in formats for fmt in {"mp4", "srt", "mp3"}):
                return artifacts
            artifacts.extend(await self._export_audiogram_video(project, formats, job_id))
            return artifacts
        scenes = copy.deepcopy(project.payload.get("scenes") or [])
        if not scenes and project.metadata_json.get("source_project_id"):
            scenes = await self._seed_video_scenes_from_source(
                mode,
                project.metadata_json.get("source_project_id"),
                payload=project.payload,
            )
            project.payload = {**(project.payload or {}), "scenes": scenes}
            project.version += 1
            await self.session.commit()
        subtitle_segments = self._build_subtitle_segments_from_scenes(scenes)
        if "srt" in formats:
            artifacts.append(
                await self._persist_text_artifact(
                    "subtitle_srt",
                    "application/x-subrip",
                    build_srt(subtitle_segments),
                    ".srt",
                    project.id,
                    job_id,
                )
            )
        if "mp4" not in formats:
            return artifacts
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            video_segments = []
            for index, scene in enumerate(scenes, start=1):
                await self._job_checkpoint(job_id, f"video_export.scene.{index}.before_render")
                slide = {
                    "title": scene.get("title"),
                    "blocks": [{"kind": "text", "data": {"content": scene.get("subtitle_text") or scene.get("narration_text") or ""}}],
                }
                image_path = temp_dir / f"scene_{index}.png"
                render_slide_image(slide, image_path)
                narration = str(scene.get("narration_text") or scene.get("subtitle_text") or scene.get("title") or "")
                synthesis = await self.provider_manager.synthesize(narration, provider="auto", output_format="mp3", speaking_rate=1.0)
                await self._job_checkpoint(job_id, f"video_export.scene.{index}.after_synthesize")
                audio_path = temp_dir / f"scene_{index}.mp3"
                audio_path.write_bytes(synthesis.payload)
                segment_path = temp_dir / f"scene_{index}.mp4"
                ffmpeg_render_slide_segment(self.settings, image_path, audio_path, segment_path)
                await self._job_checkpoint(job_id, f"video_export.scene.{index}.after_render")
                video_segments.append(segment_path)
            await self._job_checkpoint(job_id, "video_export.concat.before")
            final_path = temp_dir / f"{project.id}.mp4"
            ffmpeg_concat_video(self.settings, video_segments, final_path)
            await self._job_checkpoint(job_id, "video_export.concat.after")
            artifacts.append(await self._persist_file_artifact("video_mp4", "video/mp4", final_path, project.id, job_id))
            if "srt" not in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        "subtitle_srt",
                        "application/x-subrip",
                        build_srt(subtitle_segments),
                        ".srt",
                        project.id,
                        job_id,
                    )
                )
        return artifacts

    async def _export_report_artifacts(
        self,
        report: dict[str, Any],
        formats: list[str],
        project_id: str | None,
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = []
        title = report.get("title") or "Report"
        sections = [(section.get("title") or "Section", section.get("content") or "") for section in report.get("sections") or []]
        markdown = "# " + title + "\n\n" + "\n\n".join(f"## {heading}\n\n{body}" for heading, body in sections)
        if "markdown" in formats:
            artifacts.append(await self._persist_text_artifact("text", "text/markdown", markdown, ".md", project_id, job_id))
        if "html" in formats:
            html = f"<html><body><h1>{title}</h1>" + "".join(f"<h2>{heading}</h2><p>{body}</p>" for heading, body in sections) + "</body></html>"
            artifacts.append(await self._persist_text_artifact("text", "text/html", html, ".html", project_id, job_id))
        if "pdf" in formats:
            artifacts.append(await self._persist_bytes_artifact("presentation_pdf", "application/pdf", create_text_pdf(title, sections), ".pdf", project_id, job_id))
        if "docx" in formats:
            artifacts.append(
                await self._persist_bytes_artifact(
                    "document_docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    create_docx(title, sections),
                    ".docx",
                    project_id,
                    job_id,
                )
            )
        return artifacts

    async def _export_infographic_artifacts(
        self,
        spec: dict[str, Any],
        formats: list[str],
        project_id: str | None,
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        artifacts = []
        for output_format in formats:
            payload = infographic_to_image_bytes(spec, output_format)
            mime_type = {"png": "image/png", "svg": "image/svg+xml", "pdf": "application/pdf"}[output_format]
            kind = {"png": "image_png", "svg": "image_svg", "pdf": "presentation_pdf"}[output_format]
            artifacts.append(await self._persist_bytes_artifact(kind, mime_type, payload, f".{output_format}", project_id, job_id))
        return artifacts

    async def _export_table_artifacts(
        self,
        columns: list[dict[str, Any]],
        rows: list[dict[str, Any]],
        formats: list[str],
        project_id: str | None,
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        artifacts = []
        if "csv" in formats:
            artifacts.append(await self._persist_bytes_artifact("text", "text/csv", dataframe_to_csv_bytes(columns, rows), ".csv", project_id, job_id))
        if "xlsx" in formats:
            artifacts.append(
                await self._persist_bytes_artifact(
                    "table_xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    dataframe_to_xlsx_bytes(columns, rows),
                    ".xlsx",
                    project_id,
                    job_id,
                )
            )
        if "markdown" in formats:
            artifacts.append(await self._persist_text_artifact("text", "text/markdown", build_rows_markdown(columns, rows), ".md", project_id, job_id))
        return artifacts

    async def _rerender_segment(self, project_id: str, segment_id: str, payload: dict[str, Any], job_id: str | None) -> dict[str, Any]:
        self._ensure_segment_rerender_capabilities(payload)
        project = await self._get_project_model(project_id, expected_type="podcast_project")
        segments = copy.deepcopy(project.payload.get("segments") or [])
        index = self._find_index(segments, segment_id)
        segment = segments[index]
        base_voice = segment.get("voice") or (project.payload.get("voice_map") or {}).get(segment.get("speaker") or "", {})
        voice = self._deep_merge(base_voice or {}, payload.get("voice") or {})
        await self._job_checkpoint(job_id, "podcast_segment_rerender.before_synthesize")
        result = await self.provider_manager.synthesize(
            segment.get("text") or "",
            provider="auto",
            voice_id=(voice or {}).get("voice_id"),
            output_format=payload.get("output_format", "mp3"),
            speaking_rate=float(payload.get("speaking_rate") or 1.0),
        )
        await self._job_checkpoint(job_id, "podcast_segment_rerender.after_synthesize")
        extension = ".wav" if result.mime_type == "audio/wav" else ".mp3"
        artifact = await self._persist_bytes_artifact(
            "audio_wav" if extension == ".wav" else "audio_mp3",
            result.mime_type,
            result.payload,
            extension,
            project_id,
            job_id,
        )
        segment["audio_artifact_id"] = artifact["id"]
        segment["status"] = "voiced"
        segment["voice"] = voice or segment.get("voice")
        segments[index] = segment
        project.payload = {**(project.payload or {}), "segments": segments}
        project.version += 1
        await self.session.commit()
        return artifact

    async def _rerender_scene(self, project_id: str, scene_id: str, payload: dict[str, Any], job_id: str | None) -> dict[str, Any]:
        project = await self._get_project_model(project_id, expected_type="video_project")
        scenes = copy.deepcopy(project.payload.get("scenes") or [])
        index = self._find_index(scenes, scene_id)
        scene = scenes[index]
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            image_path = temp_dir / "scene.png"
            await self._job_checkpoint(job_id, "video_scene_rerender.before_render")
            render_slide_image({"title": scene.get("title"), "blocks": [{"kind": "text", "data": {"content": scene.get("narration_text") or ""}}]}, image_path)
            artifact = await self._persist_file_artifact("image_png", "image/png", image_path, project_id, job_id)
            await self._job_checkpoint(job_id, "video_scene_rerender.after_render")
        scene.setdefault("metadata", {})["preview_artifact_id"] = artifact["id"]
        scenes[index] = scene
        project.payload = {**(project.payload or {}), "scenes": scenes}
        project.version += 1
        await self.session.commit()
        return artifact

    async def _create_job(
        self,
        job_type: str,
        project_id: str | None,
        input_ref: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> Job:
        if idempotency_key:
            existing = await self.session.scalar(
                select(Job).where(Job.type == job_type, Job.idempotency_key == idempotency_key).order_by(Job.created_at.desc())
            )
            if existing:
                return existing
        job = Job(
            id=self._make_id("job"),
            type=job_type,
            status="queued",
            progress=0,
            request_id=get_request_id(),
            project_id=project_id,
            input_ref=copy.deepcopy(input_ref),
            result_ref={},
            provider=((input_ref.get("generation") or {}).get("provider") or input_ref.get("provider")),
            model=((input_ref.get("generation") or {}).get("model") or input_ref.get("model")),
            idempotency_key=idempotency_key,
        )
        self.session.add(job)
        await self.session.commit()
        return job

    async def _enqueue_job(self, job_id: str) -> None:
        if self.settings.inline_async_jobs:
            asyncio.create_task(run_job_inprocess(job_id))
            return
        pool = await create_pool(
            RedisSettings(
                host=self.settings.redis_host,
                port=self.settings.redis_port,
                password=self.settings.redis_password,
                database=0,
            )
        )
        await pool.enqueue_job("run_job", job_id)
        await pool.close()

    async def _project_to_response(self, project: Project) -> dict[str, Any]:
        artifacts = await self._project_artifacts(project.id)
        base = {
            "id": project.id,
            "project_type": project.project_type,
            "title": project.title,
            "status": project.status,
            "version": project.version,
            "template_id": project.template_id,
            "metadata": project.metadata_json or {},
            "settings": project.settings_json or {},
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
            "artifacts": artifacts,
        }
        payload = project.payload or {}
        if project.project_type == "presentation_project":
            return {
                **base,
                "source_inputs": payload.get("source_inputs") or [],
                "theme": payload.get("theme"),
                "slides": payload.get("slides") or [],
            }
        if project.project_type == "podcast_project":
            return {
                **base,
                "source_inputs": payload.get("source_inputs") or [],
                "speakers": payload.get("speakers") or [],
                "chapters": payload.get("chapters") or [],
                "segments": payload.get("segments") or [],
                "voice_map": payload.get("voice_map") or {},
                "music_tracks": payload.get("music_tracks") or [],
                "render_settings": payload.get("render_settings") or {},
            }
        if project.project_type == "video_project":
            return {
                **base,
                "mode": payload.get("mode", "scene_based_explainer"),
                "source_inputs": payload.get("source_inputs") or [],
                "scenes": payload.get("scenes") or [],
                "audio_tracks": payload.get("audio_tracks") or [],
                "subtitle_tracks": payload.get("subtitle_tracks") or [],
                "assets": payload.get("assets") or [],
                "render_profile": payload.get("render_profile") or {},
            }
        return {**base, "content": payload}

    def _project_summary(self, project: Project) -> dict[str, Any]:
        return {
            "id": project.id,
            "project_type": project.project_type,
            "title": project.title,
            "status": project.status,
            "version": project.version,
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
        }

    async def _job_to_response(self, job: Job) -> dict[str, Any]:
        artifacts = list(
            (await self.session.execute(select(Artifact).where(Artifact.job_id == job.id).order_by(Artifact.created_at.asc()))).scalars()
        )
        return {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "progress": job.progress,
            "request_id": job.request_id,
            "project_id": job.project_id,
            "provider": job.provider,
            "model": job.model,
            "input_ref": job.input_ref or {},
            "result_ref": job.result_ref or {},
            "artifacts": [self._artifact_to_response(artifact) for artifact in artifacts],
            "error": job.error_json,
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
        }

    def _artifact_to_response(self, artifact: Artifact) -> dict[str, Any]:
        return {
            "id": artifact.id,
            "kind": artifact.kind,
            "mime_type": artifact.mime_type,
            "size": artifact.size,
            "checksum": artifact.checksum,
            "storage_uri": artifact.storage_uri,
            "metadata": artifact.metadata_json or {},
            "project_id": artifact.project_id,
            "created_at": artifact.created_at.isoformat(),
        }

    def _artifact_filename(self, artifact: Artifact) -> str:
        parsed = urlparse(artifact.storage_uri)
        suffix = Path(parsed.path).suffix
        return f"{artifact.id}{suffix}" if suffix else artifact.id

    def _read_artifact_payload(self, artifact: Artifact) -> bytes:
        payload = self.storage.read_bytes(artifact.storage_uri)
        if artifact.checksum and checksum_bytes(payload) != artifact.checksum:
            raise RuntimeError(f"Checksum mismatch for artifact '{artifact.id}'.")
        return payload

    async def _persist_file_artifact(
        self,
        kind: str,
        mime_type: str,
        source_path: Path,
        project_id: str | None,
        job_id: str | None,
    ) -> dict[str, Any]:
        return await self._persist_bytes_artifact(kind, mime_type, source_path.read_bytes(), source_path.suffix, project_id, job_id)

    async def _persist_text_artifact(
        self,
        kind: str,
        mime_type: str,
        content: str,
        extension: str,
        project_id: str | None,
        job_id: str | None,
    ) -> dict[str, Any]:
        return await self._persist_bytes_artifact(kind, mime_type, content.encode("utf-8"), extension, project_id, job_id)

    async def _persist_bytes_artifact(
        self,
        kind: str,
        mime_type: str,
        payload: bytes,
        extension: str,
        project_id: str | None,
        job_id: str | None,
    ) -> dict[str, Any]:
        await self._job_checkpoint(job_id, f"artifact.persist.{kind}.before")
        artifact_id = self._make_id("artifact")
        relative_path = f"{kind}/{artifact_id}{extension}"
        write_result = self.storage.write_bytes(relative_path, payload)
        artifact = Artifact(
            id=artifact_id,
            kind=kind,
            mime_type=mime_type,
            size=write_result.size,
            storage_uri=write_result.storage_uri,
            checksum=write_result.checksum,
            metadata_json={"artifact_manifest_version": "1.0", "storage_backend": self.storage.backend_name},
            project_id=project_id,
            job_id=job_id,
        )
        self.session.add(artifact)
        await self.session.commit()
        logger.info(
            "Artifact persisted",
            extra={
                "extra_payload": {
                    "artifact_ids": [artifact_id],
                    "project_id": project_id,
                    "job_id": job_id,
                    "mime_type": mime_type,
                    "kind": kind,
                }
            },
        )
        await self._job_checkpoint(job_id, f"artifact.persist.{kind}.after")
        return self._artifact_to_response(artifact)

    async def _project_artifacts(self, project_id: str) -> list[dict[str, Any]]:
        rows = list((await self.session.execute(select(Artifact).where(Artifact.project_id == project_id).order_by(Artifact.created_at.asc()))).scalars())
        return [self._artifact_to_response(row) for row in rows]

    async def _create_project_from_payload(
        self,
        *,
        project_type: str,
        title: str,
        template_id: str | None,
        metadata: dict[str, Any],
        settings: dict[str, Any],
        payload: dict[str, Any],
    ) -> Project:
        project = Project(
            id=self._make_id("project"),
            project_type=project_type,
            title=title,
            status="draft",
            version=1,
            template_id=template_id,
            metadata_json=metadata,
            settings_json=settings,
            payload=payload,
        )
        self.session.add(project)
        await self.session.commit()
        return project

    async def _get_project_model(self, project_id: str, expected_type: str | None = None) -> Project:
        project = await self.session.get(Project, project_id)
        if not project:
            raise HTTPException(
                status_code=404,
                detail={"code": "project_not_found", "message": f"Project '{project_id}' not found.", "request_id": get_request_id()},
            )
        if expected_type and project.project_type != expected_type:
            raise HTTPException(
                status_code=400,
                detail={"code": "project_type_mismatch", "message": f"Project '{project_id}' is not a {expected_type}.", "request_id": get_request_id()},
            )
        return project

    async def _get_job_model(self, job_id: str) -> Job:
        job = await self.session.get(Job, job_id)
        if not job:
            raise HTTPException(
                status_code=404,
                detail={"code": "job_not_found", "message": f"Job '{job_id}' not found.", "request_id": get_request_id()},
            )
        return job

    async def _get_artifact_model(self, artifact_id: str) -> Artifact:
        artifact = await self.session.get(Artifact, artifact_id)
        if not artifact:
            raise HTTPException(
                status_code=404,
                detail={"code": "artifact_not_found", "message": f"Artifact '{artifact_id}' not found.", "request_id": get_request_id()},
            )
        return artifact

    def _normalized_messages(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for message in messages:
            content = message.get("content")
            if isinstance(content, list):
                content = json.dumps(content, ensure_ascii=True)
            normalized.append({**message, "content": str(content or "")})
        return normalized

    def _stringify_messages(self, messages: list[dict[str, Any]]) -> str:
        return "\n".join(f"{message.get('role', 'user')}: {message.get('content', '')}" for message in messages).strip()

    def _merge_generation_options(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.generation_service.merge_generation_options(payload)

    def _prepare_task_payload(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        template_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return self.generation_service.prepare_task_payload(kind, payload, template_id=template_id)

    def _resolve_template(self, kind: str, template_id: str | None = None) -> dict[str, Any]:
        return self.generation_service.resolve_template(kind, template_id)

    def _merge_missing(self, payload: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
        return self.generation_service.merge_missing(payload, defaults)

    def _apply_template_constraints(self, kind: str, payload: dict[str, Any], constraints: dict[str, Any]) -> dict[str, Any]:
        return self.generation_service.apply_template_constraints(kind, payload, constraints)

    def _build_chat_rag_messages(
        self,
        payload: dict[str, Any],
        sources: list[dict[str, Any]],
        template: dict[str, Any],
    ) -> list[dict[str, Any]]:
        source_blob = "\n\n".join(
            f"[{index}] {source.get('title') or source.get('document_id') or source.get('artifact_id') or 'Source'}\n{source.get('text') or ''}".strip()
            for index, source in enumerate(sources, start=1)
        ).strip()
        system_prompt = payload.get("system_prompt") or template.get("system_prompt") or ""
        instructions = template.get("instructions") or ""
        user_suffix = f"\n\nSources:\n{source_blob}" if source_blob else ""
        messages = self._normalized_messages(payload.get("messages") or [])
        if system_prompt or instructions:
            messages = [
                {
                    "role": "system",
                    "content": "\n".join(chunk for chunk in [system_prompt, instructions] if chunk).strip(),
                },
                *messages,
            ]
        if user_suffix and messages:
            last = dict(messages[-1])
            last["content"] = f"{last.get('content', '')}{user_suffix}".strip()
            messages[-1] = last
        return messages

    async def _structured_task_response(
        self,
        kind: str,
        payload: dict[str, Any],
        base_response: dict[str, Any],
        template: dict[str, Any],
    ) -> dict[str, Any]:
        return await self.generation_service.build_task_response(kind, payload, template, base_response)

    async def _structured_project_payload(
        self,
        kind: str,
        payload: dict[str, Any],
        base_payload: dict[str, Any],
        template: dict[str, Any],
    ) -> dict[str, Any]:
        return await self.generation_service.build_project_payload(kind, payload, template, base_payload)

    def _filter_known_response_keys(self, base_response: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in overlay.items() if key in base_response}

    def _parse_possible_json(self, value: Any) -> Any:
        return self.generation_service.parse_possible_json(value)

    def _coerce_to_schema(self, value: Any, schema: dict[str, Any], context_text: str = "") -> Any:
        return self.generation_service.coerce_to_schema(value, schema, context_text)

    def _apply_citation_mode(self, answer: str, citations: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
        del answer
        if mode == "none":
            return []
        return citations

    def _inline_citations(self, answer: str, citations: list[dict[str, Any]]) -> str:
        if not citations:
            return answer
        markers = " ".join(f"[{citation.get('index') or index}]" for index, citation in enumerate(citations[:3], start=1))
        if markers and markers not in answer:
            return f"{answer} {markers}".strip()
        return answer

    def _build_chapters_from_segments(self, segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        chapters: list[dict[str, Any]] = []
        for index, segment in enumerate(segments, start=1):
            chapters.append(
                {
                    "id": f"chapter_{index}",
                    "title": summarize_text(str(segment.get("text") or ""), 1) or f"Chapter {index}",
                    "speaker": segment.get("speaker"),
                    "start_ms": segment.get("start_ms"),
                    "end_ms": segment.get("end_ms"),
                    "segment_id": segment.get("id"),
                }
            )
        return chapters

    def _force_sync_execution(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = copy.deepcopy(payload)
        execution = normalized.get("execution") or {}
        execution["mode"] = "sync"
        normalized["execution"] = execution
        return normalized

    async def _notify_job_webhook(self, job: Job, response: dict[str, Any]) -> None:
        execution = (job.input_ref or {}).get("execution") or {}
        webhook_url = execution.get("webhook_url")
        if not webhook_url:
            return
        headers = {"Content-Type": "application/json", **(execution.get("callback_headers") or {})}
        for attempt in range(1, self.settings.webhook_retry_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                    webhook_response = await client.post(webhook_url, json={"job": response}, headers=headers)
                    webhook_response.raise_for_status()
                logger.info(
                    "Webhook delivered",
                    extra={
                        "extra_payload": {
                            "job_id": job.id,
                            "route": job.type,
                            "webhook_url": webhook_url,
                            "callback_headers": headers,
                            "attempt": attempt,
                            "status_code": webhook_response.status_code,
                        }
                    },
                )
                return
            except Exception as error:  # noqa: BLE001
                logger.warning(
                    "Webhook delivery failed",
                    extra={
                        "extra_payload": {
                            "job_id": job.id,
                            "route": job.type,
                            "webhook_url": webhook_url,
                            "callback_headers": headers,
                            "attempt": attempt,
                            "max_attempts": self.settings.webhook_retry_attempts,
                            "reason": error.__class__.__name__,
                        }
                    },
                )
                if attempt >= self.settings.webhook_retry_attempts:
                    return
                await asyncio.sleep(self.settings.webhook_backoff_seconds * attempt)

    async def _build_video_project_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        mode = payload.get("mode") or "scene_based_explainer"
        if payload.get("source_project_id"):
            scenes = await self._seed_video_scenes_from_source(mode, payload["source_project_id"], payload=payload)
            return {
                "project_format_version": "1.0",
                "mode": mode,
                "source_inputs": payload.get("sources") or [],
                "scenes": scenes,
                "audio_tracks": [{"source_project_id": payload["source_project_id"], "mode": mode}],
                "subtitle_tracks": [],
                "assets": [],
                "render_profile": payload.get("render_profile") or {"aspect_ratio": payload.get("aspect_ratio", "16:9")},
            }
        return build_video_payload(payload, mode)

    async def _seed_video_scenes_from_source(
        self,
        mode: str,
        source_project_id: str,
        *,
        payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        source_project = await self._get_project_model(source_project_id)
        source_payload = source_project.payload or {}
        if mode == "audiogram":
            if source_project.project_type != "podcast_project":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "invalid_source_project",
                        "message": "Audiogram mode requires a podcast_project source.",
                        "request_id": get_request_id(),
                    },
                )
            chapters = source_payload.get("chapters") or []
            if chapters:
                scenes = []
                for index, chapter in enumerate(chapters, start=1):
                    scenes.append(
                        {
                            "id": f"scene_{index}",
                            "title": chapter.get("title") or f"Chapter {index}",
                            "narration_text": chapter.get("summary") or source_project.title,
                            "duration_ms": None,
                            "asset_refs": [],
                            "subtitle_text": chapter.get("summary") or chapter.get("title") or source_project.title,
                            "transition": "fade",
                            "status": "draft",
                            "metadata": {"chapter_id": chapter.get("id")},
                        }
                    )
                return scenes
            segments = source_payload.get("segments") or []
            return [
                {
                    "id": f"scene_{index}",
                    "title": summarize_text(str(segment.get("text") or ""), 1) or f"Segment {index}",
                    "narration_text": segment.get("text"),
                    "duration_ms": segment.get("duration_estimate_ms"),
                    "asset_refs": [],
                    "subtitle_text": segment.get("text"),
                    "transition": "fade",
                    "status": "draft",
                    "metadata": {"segment_id": segment.get("id")},
                }
                for index, segment in enumerate(segments, start=1)
            ]
        if mode == "narrated_presentation":
            if source_project.project_type != "presentation_project":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "invalid_source_project",
                        "message": "Narrated presentation mode requires a presentation_project source.",
                        "request_id": get_request_id(),
                    },
                )
            return [
                {
                    "id": f"scene_{index}",
                    "title": slide.get("title") or f"Slide {index}",
                    "narration_text": slide.get("speaker_notes") or slide.get("title") or "",
                    "duration_ms": None,
                    "asset_refs": slide.get("source_refs") or [],
                    "subtitle_text": slide.get("title") or "",
                    "transition": "fade",
                    "status": "draft",
                    "metadata": {"slide_id": slide.get("id"), "layout": slide.get("layout")},
                }
                for index, slide in enumerate(source_payload.get("slides") or [], start=1)
            ]
        base_payload = build_video_payload({**payload, "sources": source_payload.get("source_inputs") or payload.get("sources") or []}, mode)
        return base_payload.get("scenes") or []

    def _build_subtitle_segments_from_scenes(self, scenes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        segments: list[dict[str, Any]] = []
        current_start = 0
        for index, scene in enumerate(scenes, start=1):
            text = str(scene.get("subtitle_text") or scene.get("narration_text") or scene.get("title") or "")
            duration_ms = int(scene.get("duration_ms") or estimate_audio_duration_ms(text))
            segments.append(
                {
                    "id": scene.get("id") or f"scene_{index}",
                    "start_ms": current_start,
                    "end_ms": current_start + duration_ms,
                    "text": text,
                }
            )
            current_start += duration_ms
        return segments

    async def _export_audiogram_video(
        self,
        project: Project,
        formats: list[str],
        job_id: str | None,
    ) -> list[dict[str, Any]]:
        artifacts: list[dict[str, Any]] = []
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            source_project_id = project.metadata_json.get("source_project_id")
            subtitle_segments: list[dict[str, Any]]
            if source_project_id:
                source_project = await self._get_project_model(source_project_id, expected_type="podcast_project")
                mp3_source, subtitle_segments = await self._render_podcast_audio_mix(source_project, temp_dir, job_id=job_id)
            else:
                mp3_source, subtitle_segments = await self._render_scene_audio_mix(project.payload.get("scenes") or [], temp_dir, job_id=job_id)
            if "srt" in formats or "mp4" in formats:
                artifacts.append(
                    await self._persist_text_artifact(
                        "subtitle_srt",
                        "application/x-subrip",
                        build_srt(subtitle_segments),
                        ".srt",
                        project.id,
                        job_id,
                    )
                )
            if "mp4" in formats:
                await self._job_checkpoint(job_id, "audiogram_export.before_render")
                cover_path = temp_dir / "cover.png"
                create_cover_image(project.title, cover_path)
                mp4_path = temp_dir / f"{project.id}.mp4"
                ffmpeg_render_audiogram(self.settings, mp3_source, mp4_path, cover_path)
                await self._job_checkpoint(job_id, "audiogram_export.after_render")
                artifacts.append(await self._persist_file_artifact("video_mp4", "video/mp4", mp4_path, project.id, job_id))
            if "mp3" in formats:
                artifacts.append(await self._persist_file_artifact("audio_mp3", "audio/mpeg", mp3_source, project.id, job_id))
        return artifacts

    async def _render_podcast_audio_mix(
        self,
        project: Project,
        temp_dir: Path,
        *,
        job_id: str | None = None,
    ) -> tuple[Path, list[dict[str, Any]]]:
        rendered_segments = []
        audio_paths: list[Path] = []
        current_start = 0
        for index, segment in enumerate(project.payload.get("segments") or [], start=1):
            text = str(segment.get("text") or "")
            existing_artifact_id = segment.get("audio_artifact_id")
            if existing_artifact_id:
                existing_artifact = await self._get_artifact_model(existing_artifact_id)
                audio_path = temp_dir / f"{segment['id']}{Path(existing_artifact.storage_uri).suffix}"
                audio_path.write_bytes(self._read_artifact_payload(existing_artifact))
                if audio_path.suffix != ".wav":
                    converted = temp_dir / f"{segment['id']}.wav"
                    ffmpeg_convert(self.settings, audio_path, converted)
                    audio_path = converted
                duration_ms = int(segment.get("end_ms") or 0) - int(segment.get("start_ms") or 0)
            else:
                voice = segment.get("voice") or (project.payload.get("voice_map") or {}).get(segment.get("speaker") or "", {})
                await self._job_checkpoint(job_id, f"podcast_audio_mix.segment.{index}.before_synthesize")
                result = await self.provider_manager.synthesize(
                    text,
                    provider="auto",
                    voice_id=(voice or {}).get("voice_id"),
                    output_format="wav",
                    speaking_rate=1.0,
                )
                await self._job_checkpoint(job_id, f"podcast_audio_mix.segment.{index}.after_synthesize")
                audio_path = temp_dir / f"{segment['id']}.wav"
                audio_path.write_bytes(result.payload)
                duration_ms = result.duration_ms or estimate_audio_duration_ms(text)
            audio_paths.append(audio_path)
            rendered_segments.append(
                {
                    "id": segment.get("id"),
                    "start_ms": current_start,
                    "end_ms": current_start + duration_ms,
                    "text": text,
                }
            )
            current_start += duration_ms
        if not audio_paths:
            raise RuntimeError("Podcast source does not contain audio segments.")
        wav_path = temp_dir / f"{project.id}.wav"
        await self._job_checkpoint(job_id, "podcast_audio_mix.concat.before")
        ffmpeg_concat_audio(self.settings, audio_paths, wav_path)
        await self._job_checkpoint(job_id, "podcast_audio_mix.concat.after")
        mp3_path = temp_dir / f"{project.id}.mp3"
        await self._job_checkpoint(job_id, "podcast_audio_mix.convert.before")
        ffmpeg_convert(self.settings, wav_path, mp3_path)
        await self._job_checkpoint(job_id, "podcast_audio_mix.convert.after")
        return mp3_path, rendered_segments

    async def _render_scene_audio_mix(
        self,
        scenes: list[dict[str, Any]],
        temp_dir: Path,
        *,
        job_id: str | None = None,
    ) -> tuple[Path, list[dict[str, Any]]]:
        if not scenes:
            raise RuntimeError("Video project does not contain scenes to render.")
        audio_paths: list[Path] = []
        segments = self._build_subtitle_segments_from_scenes(scenes)
        for index, scene in enumerate(scenes, start=1):
            narration = str(scene.get("narration_text") or scene.get("subtitle_text") or scene.get("title") or "")
            await self._job_checkpoint(job_id, f"scene_audio_mix.scene.{index}.before_synthesize")
            synthesis = await self.provider_manager.synthesize(narration, provider="auto", output_format="mp3", speaking_rate=1.0)
            await self._job_checkpoint(job_id, f"scene_audio_mix.scene.{index}.after_synthesize")
            audio_path = temp_dir / f"scene_{index}.mp3"
            audio_path.write_bytes(synthesis.payload)
            audio_paths.append(audio_path)
        concatenated = temp_dir / "scenes.mp3"
        await self._job_checkpoint(job_id, "scene_audio_mix.concat.before")
        ffmpeg_concat_audio(self.settings, audio_paths, concatenated)
        await self._job_checkpoint(job_id, "scene_audio_mix.concat.after")
        return concatenated, segments

    def _load_templates(self) -> list[dict[str, Any]]:
        return self.generation_service.load_templates()

    def _should_async(self, operation: str, execution: dict[str, Any], payload: dict[str, Any]) -> bool:
        mode = execution.get("mode", "auto")
        if mode == "sync":
            return False
        if mode == "async":
            return True
        if operation in {"speech.synthesis", "task.presentation", "task.podcast", "task.video", "export.project", "podcast.rerender_segment", "video.rerender_scene", "presentation.regenerate_slide"}:
            return True
        if set(payload.get("formats") or []) & HEAVY_FORMATS:
            return True
        if set(payload.get("render_formats") or []) & HEAVY_FORMATS:
            return True
        if set(payload.get("output_formats") or []) & HEAVY_FORMATS:
            return True
        source_count = len(payload.get("sources") or payload.get("documents") or [])
        if source_count > self.settings.async_source_threshold:
            return True
        if int(payload.get("slide_count_hint") or 0) >= self.settings.async_slide_threshold:
            return True
        if int(payload.get("duration_hint_minutes") or 0) >= self.settings.async_duration_minutes_threshold:
            return True
        return False

    def _ensure_speech_capabilities(self, payload: dict[str, Any]) -> None:
        requested_style = payload.get("style") or (payload.get("voice") or {}).get("style")
        if not requested_style:
            for segment in payload.get("segments") or []:
                segment_voice = segment.get("voice") or {}
                if segment_voice.get("style"):
                    requested_style = segment_voice["style"]
                    break
        if requested_style and not self.provider_manager.capability_available(
            "style_control",
            provider=payload.get("provider", "auto"),
            candidates=["piper", "edge"],
        ):
            raise UnsupportedCapabilityError("style_control", "Speech style control is not supported by configured TTS providers.")

    def _ensure_segment_rerender_capabilities(self, payload: dict[str, Any]) -> None:
        requested_style = payload.get("style") or (payload.get("voice") or {}).get("style")
        if requested_style and not self.provider_manager.capability_available(
            "style_control",
            candidates=["piper", "edge"],
        ):
            raise UnsupportedCapabilityError("style_control", "Speech style control is not supported by configured TTS providers.")

    def _default_payload(self, project_type: str, content: dict[str, Any]) -> dict[str, Any]:
        base = {"project_format_version": "1.0"}
        if project_type == "presentation_project":
            return {**base, "source_inputs": [], "theme": None, "slides": [], **content}
        if project_type == "podcast_project":
            return {**base, "source_inputs": [], "speakers": [], "chapters": [], "segments": [], "voice_map": {}, "music_tracks": [], "render_settings": {}, **content}
        if project_type == "video_project":
            return {**base, "mode": "scene_based_explainer", "source_inputs": [], "scenes": [], "audio_tracks": [], "subtitle_tracks": [], "assets": [], "render_profile": {}, **content}
        return {**base, **content}

    def _parse_cursor(self, cursor: str | None) -> int:
        if not cursor:
            return 0
        try:
            return max(0, int(cursor))
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail={"code": "invalid_cursor", "message": "Cursor must be an integer offset.", "request_id": get_request_id()},
            ) from None

    def _make_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:16]}"

    def _find_index(self, rows: list[dict[str, Any]], identifier: str) -> int:
        for index, row in enumerate(rows):
            if row.get("id") == identifier:
                return index
        raise HTTPException(
            status_code=404,
            detail={"code": "entity_not_found", "message": f"Item '{identifier}' not found.", "request_id": get_request_id()},
        )

    def _deep_merge(self, current: Any, patch: Any) -> Any:
        if isinstance(current, dict) and isinstance(patch, dict):
            merged = dict(current)
            for key, value in patch.items():
                merged[key] = self._deep_merge(merged.get(key), value)
            return merged
        return patch if patch is not None else current


async def build_service_with_session(session: AsyncSession, session_factory: async_sessionmaker[AsyncSession]) -> PlatformService:
    settings = get_settings()
    from ml_service.storage.factory import build_artifact_storage

    return PlatformService(
        session=session,
        session_factory=session_factory,
        settings=settings,
        provider_manager=ProviderManager(settings),
        storage=build_artifact_storage(settings),
    )


async def run_job_inprocess(job_id: str) -> dict[str, Any]:
    from ml_service.db.session import create_engine, create_session_factory

    settings = get_settings()
    engine = create_engine(settings)
    session_factory = create_session_factory(engine)
    async with session_factory() as session:
        service = await build_service_with_session(session, session_factory)
        try:
            return await service.run_job(job_id)
        finally:
            await engine.dispose()
