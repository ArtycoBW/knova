from __future__ import annotations

import json
import time

import httpx

from ml_service.providers.base import EmbeddingResult, SynthesisResult
from ml_service.providers.manager import ProviderManager


def test_chat_completion_supports_json_schema_response_format(client):
    response = client.post(
        "/v1/chat/completions",
        json={
            "messages": [{"role": "user", "content": "Create a title and summary for AI orchestration."}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "summary": {"type": "string"},
                    },
                    "required": ["title", "summary"],
                },
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    structured = json.loads(payload["choices"][0]["message"]["content"])
    assert set(structured.keys()) == {"title", "summary"}


def test_embeddings_pass_dimensions_and_task_type(client):
    captured: dict[str, object] = {}

    async def fake_embeddings(inputs, *, provider, model_alias, task_type, dimensions):
        captured["inputs"] = inputs
        captured["provider"] = provider
        captured["model_alias"] = model_alias
        captured["task_type"] = task_type
        captured["dimensions"] = dimensions
        return EmbeddingResult(
            vectors=[[1.0, 2.0, 3.0, 4.0]],
            provider="fake",
            model="fake-embed",
            usage={"prompt_tokens": 1, "total_tokens": 1},
        )

    client.app.state.provider_manager.embeddings = fake_embeddings

    response = client.post(
        "/v1/embeddings",
        json={
            "input": "hello world",
            "dimensions": 6,
            "task_type": "classification",
            "provider": "auto",
            "model": "embedding-default",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert captured["task_type"] == "classification"
    assert captured["dimensions"] == 6
    assert len(payload["data"][0]["embedding"]) == 6


def test_async_speech_reuses_idempotency_key_and_calls_webhook(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, provider, voice_id, speaking_rate
        mime_type = "audio/mpeg" if output_format == "mp3" else "audio/wav"
        return SynthesisResult(
            payload=b"ID3stub-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type=mime_type,
            duration_ms=1200,
        )

    webhook_calls: list[dict] = []

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        del self, kwargs
        webhook_calls.append({"url": url, "json": json, "headers": headers})
        return httpx.Response(status_code=200, request=httpx.Request("POST", url))

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    request_payload = {
        "text": "Hello from async speech.",
        "execution": {
            "mode": "async",
            "idempotency_key": "speech-1",
            "webhook_url": "https://callback.test/job",
            "callback_headers": {"X-Test": "1"},
        },
    }
    first = client.post("/v1/audio/speech", json=request_payload)
    second = client.post("/v1/audio/speech", json=request_payload)

    assert first.status_code == 202
    assert second.status_code == 202
    first_job_id = first.json()["job"]["id"]
    second_job_id = second.json()["job"]["id"]
    assert first_job_id == second_job_id

    final_payload = None
    for _ in range(30):
        job_response = client.get(f"/v1/jobs/{first_job_id}")
        assert job_response.status_code == 200
        final_payload = job_response.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed"
    assert webhook_calls
    assert webhook_calls[0]["url"] == "https://callback.test/job"
    assert webhook_calls[0]["headers"]["X-Test"] == "1"
    assert webhook_calls[0]["json"]["job"]["id"] == first_job_id


def test_video_task_builds_scenes_from_source_project(client):
    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "presentation_project",
            "title": "Narrated deck",
            "content": {
                "slides": [
                    {
                        "id": "slide_1",
                        "kind": "title",
                        "title": "Intro",
                        "subtitle": "Overview",
                        "speaker_notes": "Explain the opening slide.",
                        "blocks": [{"kind": "text", "data": {"content": "Hello"}}],
                    }
                ]
            },
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    video_response = client.post(
        "/v1/tasks/video",
        json={
            "mode": "narrated_presentation",
            "source_project_id": project_id,
            "execution": {"mode": "sync"},
        },
    )

    assert video_response.status_code == 200
    payload = video_response.json()["project"]
    assert payload["mode"] == "narrated_presentation"
    assert payload["metadata"]["source_project_id"] == project_id
    assert payload["scenes"][0]["metadata"]["slide_id"] == "slide_1"


def test_request_validation_returns_422_for_invalid_payload(client):
    response = client.post("/v1/projects", json={"project_type": "presentation_project"})
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_templates_support_kind_filter(client):
    response = client.get("/v1/templates", params={"kind": "quiz"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]
    assert all(item["kind"] == "quiz" for item in payload["data"])


def test_webhook_delivery_retries_until_success(client_factory, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, speaking_rate
        mime_type = "audio/mpeg" if output_format == "mp3" else "audio/wav"
        return SynthesisResult(
            payload=b"ID3retry-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type=mime_type,
            duration_ms=1200,
        )

    attempts: list[int] = []

    async def flaky_post(self, url, json=None, headers=None, **kwargs):
        del self, kwargs
        attempts.append(len(attempts) + 1)
        if len(attempts) < 3:
            raise httpx.ConnectError("temporary failure", request=httpx.Request("POST", url))
        return httpx.Response(status_code=200, request=httpx.Request("POST", url), json={"ok": True})

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)
    monkeypatch.setattr(httpx.AsyncClient, "post", flaky_post)

    with client_factory(AI_SERVICE_WEBHOOK_BACKOFF_SECONDS="0.01") as client:
        response = client.post(
            "/v1/audio/speech",
            json={
                "text": "Retry webhook delivery.",
                "execution": {
                    "mode": "async",
                    "idempotency_key": "speech-webhook-retry",
                    "webhook_url": "https://callback.test/retry",
                    "callback_headers": {"X-Test": "1"},
                },
            },
        )
        assert response.status_code == 202
        job_id = response.json()["job"]["id"]

        final_payload = None
        for _ in range(30):
            job_response = client.get(f"/v1/jobs/{job_id}")
            assert job_response.status_code == 200
            final_payload = job_response.json()
            if final_payload["status"] in {"completed", "failed"}:
                break
            time.sleep(0.1)

        assert final_payload is not None
        assert final_payload["status"] == "completed"

        for _ in range(30):
            if attempts == [1, 2, 3]:
                break
            time.sleep(0.05)

    assert attempts == [1, 2, 3]


def test_presentation_mp4_export_produces_video_artifacts(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id=None, output_format, speaking_rate):
        del self, text, provider, voice_id, output_format, speaking_rate
        return SynthesisResult(
            payload=b"ID3presentation-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type="audio/mpeg",
            duration_ms=1200,
        )

    def fake_render_slide_image(slide, output_path):
        del slide
        output_path.write_bytes(b"PNGslide")

    def fake_render_slide_segment(settings, image_path, audio_path, output_path):
        del settings, image_path, audio_path
        output_path.write_bytes(b"MP4segment")

    def fake_concat_video(settings, inputs, output_path):
        del settings
        output_path.write_bytes(inputs[0].read_bytes())

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)
    monkeypatch.setattr("ml_service.services.platform.render_slide_image", fake_render_slide_image)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_render_slide_segment", fake_render_slide_segment)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_concat_video", fake_concat_video)

    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "presentation_project",
            "title": "Narrated deck",
            "content": {
                "slides": [
                    {
                        "id": "slide_1",
                        "kind": "title",
                        "title": "Intro",
                        "speaker_notes": "Explain the opening slide.",
                        "blocks": [{"kind": "text", "data": {"content": "Hello"}}],
                    }
                ]
            },
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    export_response = client.post(
        f"/v1/projects/{project_id}/export",
        json={"formats": ["mp4"], "execution": {"mode": "sync"}},
    )
    assert export_response.status_code == 200
    artifact_kinds = {artifact["kind"] for artifact in export_response.json()["artifacts"]}
    assert "video_mp4" in artifact_kinds
    assert "subtitle_srt" in artifact_kinds


def test_audiogram_video_export_produces_mp4_and_captions(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, speaking_rate
        mime_type = "audio/mpeg" if output_format == "mp3" else "audio/wav"
        return SynthesisResult(
            payload=b"RIFFpodcast-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type=mime_type,
            duration_ms=900,
        )

    def fake_concat_audio(settings, inputs, output_path):
        del settings
        output_path.write_bytes(inputs[0].read_bytes())

    def fake_convert(settings, input_path, output_path):
        del settings
        output_path.write_bytes(input_path.read_bytes())

    def fake_render_audiogram(settings, audio_path, output_path, cover_path):
        del settings, audio_path, cover_path
        output_path.write_bytes(b"MP4audiogram")

    def fake_cover_image(title, output_path):
        del title
        output_path.write_bytes(b"PNGcover")

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_concat_audio", fake_concat_audio)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_convert", fake_convert)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_render_audiogram", fake_render_audiogram)
    monkeypatch.setattr("ml_service.services.platform.create_cover_image", fake_cover_image)

    podcast_response = client.post(
        "/v1/projects",
        json={
            "project_type": "podcast_project",
            "title": "Podcast source",
            "content": {
                "segments": [
                    {
                        "id": "seg_1",
                        "speaker": "host",
                        "text": "Welcome to the show",
                        "voice": {"voice_id": "host-voice"},
                        "status": "draft",
                    }
                ]
            },
        },
    )
    assert podcast_response.status_code == 200
    podcast_project_id = podcast_response.json()["id"]

    video_response = client.post(
        "/v1/tasks/video",
        json={
            "mode": "audiogram",
            "source_project_id": podcast_project_id,
            "execution": {"mode": "sync"},
        },
    )
    assert video_response.status_code == 200
    video_project_id = video_response.json()["project"]["id"]

    export_response = client.post(
        f"/v1/projects/{video_project_id}/export",
        json={"formats": ["mp4", "mp3", "srt"], "execution": {"mode": "sync"}},
    )
    assert export_response.status_code == 200
    artifact_kinds = {artifact["kind"] for artifact in export_response.json()["artifacts"]}
    assert "video_mp4" in artifact_kinds
    assert "audio_mp3" in artifact_kinds
    assert "subtitle_srt" in artifact_kinds
