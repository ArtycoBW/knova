from __future__ import annotations

import asyncio
import json
import logging
import time

import pytest

from ml_service.core.logging import REDACTED, get_logger
from ml_service.db.schema import resolve_database_url, resolve_db_schema
from ml_service.providers.base import SynthesisResult
from ml_service.providers.manager import ProviderManager


def test_json_body_limit_returns_413(client_factory):
    with client_factory(AI_SERVICE_MAX_JSON_BODY_BYTES="96") as client:
        response = client.post(
            "/v1/tasks/quiz",
            json={"prompt": "x" * 1024, "execution": {"mode": "sync"}},
        )

    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"
    assert response.json()["details"]["limit_name"] == "json_body_bytes"


def test_default_sqlite_resolution_uses_absolute_path_and_no_schema():
    resolved_database_url = resolve_database_url(None)

    assert resolved_database_url.startswith("sqlite+aiosqlite:////")
    assert resolve_db_schema(None, None) is None
    assert resolve_db_schema(None, "postgresql://db.example/app") == "ml"


def test_upload_limit_returns_413(client_factory):
    with client_factory(AI_SERVICE_MAX_UPLOAD_BYTES="16") as client:
        response = client.post(
            "/v1/audio/transcriptions",
            data={},
            files={"file": ("clip.wav", b"0123456789" * 8, "audio/wav")},
        )

    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"
    assert response.json()["details"]["limit_name"] == "upload_bytes"


def test_audio_duration_limit_rejects_long_speech(client_factory):
    with client_factory(AI_SERVICE_MAX_AUDIO_DURATION_SECONDS="1") as client:
        response = client.post(
            "/v1/audio/speech",
            json={
                "text": " ".join(["lengthy"] * 64),
                "execution": {"mode": "sync"},
            },
        )

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_media"
    assert response.json()["details"]["limit_name"] == "audio_duration_seconds"


def test_video_duration_limit_rejects_presentation_mp4_export(client_factory):
    with client_factory(AI_SERVICE_MAX_VIDEO_DURATION_SECONDS="1") as client:
        create_response = client.post(
            "/v1/projects",
            json={
                "project_type": "presentation_project",
                "title": "Long Deck",
                "content": {
                    "slides": [
                        {
                            "id": "slide_1",
                            "kind": "content",
                            "title": "Overview",
                            "speaker_notes": " ".join(["narration"] * 80),
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

    assert export_response.status_code == 400
    assert export_response.json()["code"] == "invalid_media"
    assert export_response.json()["details"]["limit_name"] == "video_duration_seconds"


def test_async_job_cancellation_stays_cancelled(client, monkeypatch):
    async def slow_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, output_format, speaking_rate
        await asyncio.sleep(0.2)
        return SynthesisResult(
            payload=b"ID3slow-audio",
            provider="fake-tts",
            model="slow-voice",
            mime_type="audio/mpeg",
            duration_ms=900,
        )

    monkeypatch.setattr(ProviderManager, "synthesize", slow_synthesize)

    response = client.post(
        "/v1/audio/speech",
        json={
            "segments": [
                {"id": "seg_1", "text": "One"},
                {"id": "seg_2", "text": "Two"},
                {"id": "seg_3", "text": "Three"},
            ],
            "execution": {"mode": "async"},
        },
    )
    assert response.status_code == 202
    job_id = response.json()["job"]["id"]

    for _ in range(30):
        status_payload = client.get(f"/v1/jobs/{job_id}").json()
        if status_payload["status"] in {"queued", "running"}:
            break
        time.sleep(0.02)

    cancel_response = client.post(f"/v1/jobs/{job_id}/cancel")
    assert cancel_response.status_code == 200

    final_payload = None
    for _ in range(60):
        job_response = client.get(f"/v1/jobs/{job_id}")
        assert job_response.status_code == 200
        final_payload = job_response.json()
        if final_payload["status"] == "cancelled":
            break
        time.sleep(0.05)

    assert final_payload is not None
    assert final_payload["status"] == "cancelled"
    assert final_payload["artifacts"] == []


def test_redaction_masks_secret_like_fields_in_logs(client, json_log_capture):
    logger = get_logger("ml_service.tests.redaction")

    with json_log_capture("ml_service.tests.redaction") as stream:
        logger.info(
            "Secret log",
            extra={
                "extra_payload": {
                    "authorization": "Bearer secret-token",
                    "api_key": "api-key-value",
                    "password": "pwd",
                    "callback_headers": {"X-Secret": "hidden"},
                    "safe": "visible",
                }
            }
        )
        for handler in logging.getLogger().handlers:
            handler.flush()

    captured = stream.getvalue()
    payload = json.loads(captured.strip().splitlines()[-1])
    assert payload["authorization"] == REDACTED
    assert payload["api_key"] == REDACTED
    assert payload["password"] == REDACTED
    assert payload["callback_headers"]["X-Secret"] == REDACTED
    assert payload["safe"] == "visible"


def test_podcast_segment_voice_and_ssml_survive_rerender(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, speaking_rate
        mime_type = "audio/mpeg" if output_format == "mp3" else "audio/wav"
        return SynthesisResult(
            payload=b"ID3voice-audio",
            provider="fake-tts",
            model="voice-v1",
            mime_type=mime_type,
            duration_ms=700,
        )

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)

    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "podcast_project",
            "title": "Episode",
            "content": {
                "segments": [
                    {
                        "id": "seg_1",
                        "speaker": "host",
                        "text": "Welcome back",
                        "ssml": "<speak>Welcome back</speak>",
                        "voice": {"voice_id": "host-voice", "style": "warm"},
                        "status": "draft",
                    }
                ]
            },
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    rerender_response = client.post(
        f"/v1/projects/{project_id}/segments/seg_1/rerender",
        json={"output_format": "mp3", "voice": {"voice_id": "host-voice-v2"}},
    )
    assert rerender_response.status_code == 202
    job_id = rerender_response.json()["job"]["id"]

    for _ in range(30):
        job_payload = client.get(f"/v1/jobs/{job_id}").json()
        if job_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    project_response = client.get(f"/v1/projects/{project_id}")
    assert project_response.status_code == 200
    segment = project_response.json()["segments"][0]
    assert segment["audio_artifact_id"]
    assert segment["ssml"] == "<speak>Welcome back</speak>"
    assert segment["voice"]["voice_id"] == "host-voice-v2"


def test_podcast_mp3_export_still_produces_artifacts(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, speaking_rate
        return SynthesisResult(
            payload=b"RIFFstub-audio",
            provider="fake-tts",
            model="voice-v1",
            mime_type="audio/wav",
            duration_ms=900,
        )

    def fake_concat_audio(settings, inputs, output_path):
        del settings
        output_path.write_bytes(inputs[0].read_bytes())

    def fake_convert(settings, input_path, output_path):
        del settings
        output_path.write_bytes(input_path.read_bytes())

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_concat_audio", fake_concat_audio)
    monkeypatch.setattr("ml_service.services.platform.ffmpeg_convert", fake_convert)

    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "podcast_project",
            "title": "Episode",
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
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    export_response = client.post(
        f"/v1/projects/{project_id}/export",
        json={"formats": ["mp3"], "execution": {"mode": "sync"}},
    )

    assert export_response.status_code == 200
    assert export_response.json()["artifacts"]


def test_production_profile_requires_bearer_token(client_factory):
    with pytest.raises(RuntimeError, match="AI_SERVICE_BEARER_TOKEN is required in production"):
        with client_factory(
            NODE_ENV="production",
            AI_SERVICE_DISABLE_AUTH="false",
            FFMPEG_BINARY="sh",
            LIBREOFFICE_BINARY="python3",
        ):
            pass


def test_s3_backend_requires_credentials(client_factory):
    with pytest.raises(RuntimeError, match="AI_SERVICE_S3_BUCKET is required when AI_SERVICE_STORAGE_BACKEND=s3"):
        with client_factory(AI_SERVICE_STORAGE_BACKEND="s3"):
            pass
