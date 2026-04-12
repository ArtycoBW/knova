from __future__ import annotations

import shutil
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import text

from ml_service.api.deps import AuthorizedService, get_service
from ml_service.api import schemas
from ml_service.services.platform import PlatformService


router = APIRouter()


def model_response(model: schemas.StrictModel, status_code: int = status.HTTP_200_OK) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=model.model_dump(mode="json", exclude_none=True))


@router.get("/health/live", tags=["Health"])
async def get_live_health() -> schemas.HealthResponse:
    return schemas.HealthResponse(status="ok", timestamp=datetime.now(UTC).isoformat())


@router.get("/health/ready", tags=["Health"])
async def get_ready_health(request: Request) -> JSONResponse:
    checks = []
    overall = "ok"
    core_failed = False

    async with request.app.state.session_factory() as session:
        try:
            await session.execute(text("SELECT 1"))
            checks.append({"name": "database", "status": "ok"})
        except Exception as error:  # noqa: BLE001
            checks.append({"name": "database", "status": "failed", "details": {"message": str(error)}})
            overall = "degraded"
            core_failed = True

    redis = request.app.state.redis
    if redis is not None:
        try:
            await redis.ping()
            checks.append({"name": "redis", "status": "ok"})
        except Exception as error:  # noqa: BLE001
            checks.append({"name": "redis", "status": "failed", "details": {"message": str(error)}})
            overall = "degraded"
            core_failed = True
    else:
        checks.append({"name": "redis", "status": "degraded", "details": {"message": "Redis unavailable; inline async jobs only."}})
        overall = "degraded"

    storage_check = request.app.state.storage.healthcheck()
    checks.append({"name": "storage", **storage_check})
    if storage_check["status"] != "ok":
        overall = "degraded"
        core_failed = True

    for binary_name, label in [
        (request.app.state.settings.ffmpeg_binary, "ffmpeg"),
        (request.app.state.settings.libreoffice_binary, "libreoffice"),
    ]:
        checks.append(
            {
                "name": label,
                "status": "ok" if shutil.which(binary_name) else "degraded",
                "details": {"binary": binary_name},
            }
        )
        if not shutil.which(binary_name):
            overall = "degraded"

    for check in request.app.state.provider_manager.provider_health_checks():
        checks.append(check)
        if check["status"] != "ok":
            overall = "degraded"

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE if core_failed else status.HTTP_200_OK
    return model_response(
        schemas.ReadinessResponse(status=overall, timestamp=datetime.now(UTC).isoformat(), checks=checks),
        status_code=status_code,
    )


@router.get("/v1/providers", tags=["Catalog"], dependencies=[AuthorizedService])
async def list_providers(service: PlatformService = Depends(get_service)) -> schemas.ProviderListResponse:
    return schemas.ProviderListResponse.model_validate(await service.list_providers())


@router.get("/v1/models", tags=["Catalog", "Compatibility"], dependencies=[AuthorizedService])
async def list_models(service: PlatformService = Depends(get_service)) -> schemas.ModelListResponse:
    return schemas.ModelListResponse.model_validate(await service.list_models())


@router.post("/v1/chat/completions", tags=["Compatibility"], dependencies=[AuthorizedService])
async def create_chat_completion(
    payload: schemas.ChatCompletionRequest,
    service: PlatformService = Depends(get_service),
):
    payload_dict = payload.model_dump(mode="json", exclude_none=True)
    if payload.stream:

        async def event_stream():
            async for chunk in service.stream_chat_completion(payload_dict):
                yield {"data": chunk}

        return EventSourceResponse(event_stream())
    return schemas.ChatCompletionResponse.model_validate(await service.create_chat_completion(payload_dict))


@router.post("/v1/embeddings", tags=["Compatibility"], dependencies=[AuthorizedService])
async def create_embeddings(
    payload: schemas.EmbeddingsRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.EmbeddingsResponse:
    return schemas.EmbeddingsResponse.model_validate(
        await service.create_embeddings(payload.model_dump(mode="json", exclude_none=True))
    )


@router.post("/v1/audio/transcriptions", tags=["Compatibility"], dependencies=[AuthorizedService])
async def create_transcription(
    file: UploadFile = File(...),
    model: str = Form("stt-default"),
    provider: str = Form("auto"),
    language: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    response_format: str = Form("verbose_json"),
    timestamp_granularities: list[str] | None = Form(default=None),
    diarization: bool = Form(default=False),
    speaker_count_hint: int | None = Form(default=None),
    service: PlatformService = Depends(get_service),
) -> schemas.TranscriptionResponse:
    form_payload = schemas.TranscriptionMultipartRequest(
        model=model,
        provider=provider,
        language=language,
        prompt=prompt,
        response_format=response_format,
        timestamp_granularities=timestamp_granularities or [],
        diarization=diarization,
        speaker_count_hint=speaker_count_hint,
    )
    return schemas.TranscriptionResponse.model_validate(
        await service.transcribe_upload(
            file,
            form_payload.model_dump(mode="json", exclude_none=True),
        )
    )


@router.post("/v1/audio/speech", tags=["Compatibility"], dependencies=[AuthorizedService])
async def create_speech(
    payload: schemas.SpeechSynthesisRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.create_speech(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.SpeechSynthesisResponse.model_validate(response), status_code)


@router.post("/v1/tasks/chat-rag", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_chat_rag(
    payload: schemas.ChatRagRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_chat_rag(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.ChatRagResponse.model_validate(response), status_code)


@router.post("/v1/tasks/compare", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_compare(
    payload: schemas.CompareRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_compare(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.CompareResponse.model_validate(response), status_code)


@router.post("/v1/tasks/mindmap", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_mindmap(
    payload: schemas.MindmapRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_mindmap(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.MindmapResponse.model_validate(response), status_code)


@router.post("/v1/tasks/quiz", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_quiz(
    payload: schemas.QuizRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_quiz(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.QuizResponse.model_validate(response), status_code)


@router.post("/v1/tasks/table", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_table(
    payload: schemas.TableRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_table(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.TableResponse.model_validate(response), status_code)


@router.post("/v1/tasks/infographic", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_infographic(
    payload: schemas.InfographicRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_infographic(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.InfographicResponse.model_validate(response), status_code)


@router.post("/v1/tasks/report", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_report(
    payload: schemas.ReportRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_report(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.ReportResponse.model_validate(response), status_code)


@router.post("/v1/tasks/presentation", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_presentation(
    payload: schemas.PresentationTaskRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_presentation(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.PresentationTaskResponse.model_validate(response), status_code)


@router.post("/v1/tasks/podcast", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_podcast(
    payload: schemas.PodcastTaskRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_podcast(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.PodcastTaskResponse.model_validate(response), status_code)


@router.post("/v1/tasks/video", tags=["Tasks"], dependencies=[AuthorizedService])
async def run_video(
    payload: schemas.VideoTaskRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.run_video(payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.VideoTaskResponse.model_validate(response), status_code)


@router.get("/v1/projects", tags=["Projects"], dependencies=[AuthorizedService])
async def list_projects(
    project_type: str | None = None,
    status: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1),
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectListResponse:
    return schemas.ProjectListResponse.model_validate(
        await service.list_projects(project_type=project_type, status_filter=status, cursor=cursor, limit=limit)
    )


@router.post("/v1/projects", tags=["Projects"], dependencies=[AuthorizedService])
async def create_project(
    payload: schemas.ProjectCreateRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.create_project(payload.model_dump(mode="json", exclude_none=True))
    )


@router.get("/v1/projects/{project_id}", tags=["Projects"], dependencies=[AuthorizedService])
async def get_project(project_id: str, service: PlatformService = Depends(get_service)) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(await service.get_project(project_id))


@router.patch("/v1/projects/{project_id}", tags=["Projects"], dependencies=[AuthorizedService])
async def patch_project(
    project_id: str,
    payload: schemas.ProjectPatchRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.patch_project(project_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.delete("/v1/projects/{project_id}", tags=["Projects"], dependencies=[AuthorizedService], status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, service: PlatformService = Depends(get_service)) -> Response:
    await service.delete_project(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/v1/projects/{project_id}/export", tags=["Projects"], dependencies=[AuthorizedService])
async def export_project(
    project_id: str,
    payload: schemas.ExportRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.export_project(project_id, payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return model_response(schemas.ExportResponse.model_validate(response), status_code)


@router.post("/v1/projects/{project_id}/slides", tags=["Projects"], dependencies=[AuthorizedService])
async def add_slide(
    project_id: str,
    payload: schemas.AddSlideRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.add_slide(project_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.patch("/v1/projects/{project_id}/slides/{slide_id}", tags=["Projects"], dependencies=[AuthorizedService])
async def update_slide(
    project_id: str,
    slide_id: str,
    payload: schemas.UpdateSlideRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.update_slide(project_id, slide_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.delete("/v1/projects/{project_id}/slides/{slide_id}", tags=["Projects"], dependencies=[AuthorizedService], status_code=status.HTTP_204_NO_CONTENT)
async def delete_slide(project_id: str, slide_id: str, service: PlatformService = Depends(get_service)) -> Response:
    await service.delete_slide(project_id, slide_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/v1/projects/{project_id}/slides/{slide_id}/regenerate", tags=["Projects"], dependencies=[AuthorizedService])
async def regenerate_slide(
    project_id: str,
    slide_id: str,
    payload: schemas.RegenerateSlideRequest,
    service: PlatformService = Depends(get_service),
):
    status_code, response = await service.regenerate_slide(project_id, slide_id, payload.model_dump(mode="json", exclude_none=True))
    if status_code == status.HTTP_202_ACCEPTED:
        return model_response(schemas.JobAcceptedResponse.model_validate(response), status_code)
    return schemas.validate_project_envelope(response)


@router.patch("/v1/projects/{project_id}/segments/{segment_id}", tags=["Projects"], dependencies=[AuthorizedService])
async def update_segment(
    project_id: str,
    segment_id: str,
    payload: schemas.UpdateSegmentRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.update_segment(project_id, segment_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.post("/v1/projects/{project_id}/segments/{segment_id}/rerender", tags=["Projects"], dependencies=[AuthorizedService], status_code=status.HTTP_202_ACCEPTED)
async def rerender_segment(
    project_id: str,
    segment_id: str,
    payload: schemas.RerenderSegmentRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.JobAcceptedResponse:
    return schemas.JobAcceptedResponse.model_validate(
        await service.rerender_segment(project_id, segment_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.patch("/v1/projects/{project_id}/scenes/{scene_id}", tags=["Projects"], dependencies=[AuthorizedService])
async def update_scene(
    project_id: str,
    scene_id: str,
    payload: schemas.UpdateSceneRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.ProjectEnvelope:
    return schemas.validate_project_envelope(
        await service.update_scene(project_id, scene_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.post("/v1/projects/{project_id}/scenes/{scene_id}/rerender", tags=["Projects"], dependencies=[AuthorizedService], status_code=status.HTTP_202_ACCEPTED)
async def rerender_scene(
    project_id: str,
    scene_id: str,
    payload: schemas.RerenderSceneRequest,
    service: PlatformService = Depends(get_service),
) -> schemas.JobAcceptedResponse:
    return schemas.JobAcceptedResponse.model_validate(
        await service.rerender_scene(project_id, scene_id, payload.model_dump(mode="json", exclude_none=True))
    )


@router.get("/v1/jobs", tags=["Jobs"], dependencies=[AuthorizedService])
async def list_jobs(
    type: str | None = None,
    status: str | None = None,
    project_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1),
    service: PlatformService = Depends(get_service),
) -> schemas.JobListResponse:
    return schemas.JobListResponse.model_validate(
        await service.list_jobs(job_type=type, status_filter=status, project_id=project_id, cursor=cursor, limit=limit)
    )


@router.get("/v1/jobs/{job_id}", tags=["Jobs"], dependencies=[AuthorizedService])
async def get_job(job_id: str, service: PlatformService = Depends(get_service)) -> schemas.Job:
    return schemas.Job.model_validate(await service.get_job(job_id))


@router.post("/v1/jobs/{job_id}/cancel", tags=["Jobs"], dependencies=[AuthorizedService])
async def cancel_job(job_id: str, service: PlatformService = Depends(get_service)) -> schemas.Job:
    return schemas.Job.model_validate(await service.cancel_job(job_id))


@router.get("/v1/artifacts", tags=["Artifacts"], dependencies=[AuthorizedService])
async def list_artifacts(
    kind: str | None = None,
    project_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1),
    service: PlatformService = Depends(get_service),
) -> schemas.ArtifactListResponse:
    return schemas.ArtifactListResponse.model_validate(
        await service.list_artifacts(kind=kind, project_id=project_id, cursor=cursor, limit=limit)
    )


@router.get("/v1/artifacts/{artifact_id}", tags=["Artifacts"], dependencies=[AuthorizedService])
async def get_artifact(artifact_id: str, service: PlatformService = Depends(get_service)) -> schemas.Artifact:
    return schemas.Artifact.model_validate(await service.get_artifact(artifact_id))


@router.get("/v1/artifacts/{artifact_id}/download", tags=["Artifacts"], dependencies=[AuthorizedService])
async def download_artifact(artifact_id: str, service: PlatformService = Depends(get_service)) -> Response:
    filename, mime_type, payload = await service.download_artifact(artifact_id)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=payload, media_type=mime_type, headers=headers)


@router.get("/v1/templates", tags=["Templates"], dependencies=[AuthorizedService])
async def list_templates(
    kind: str | None = None,
    version: str | None = None,
    service: PlatformService = Depends(get_service),
) -> schemas.TemplateListResponse:
    return schemas.TemplateListResponse.model_validate(await service.list_templates(kind=kind, version=version))


@router.get("/v1/templates/{template_id}", tags=["Templates"], dependencies=[AuthorizedService])
async def get_template(template_id: str, service: PlatformService = Depends(get_service)) -> schemas.Template:
    return schemas.Template.model_validate(await service.get_template(template_id))
