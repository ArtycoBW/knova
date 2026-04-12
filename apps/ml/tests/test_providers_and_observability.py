from __future__ import annotations

import json
import time

from ml_service.providers.base import EmbeddingResult, ProviderError, SynthesisResult, TextGenerationResult
from ml_service.providers.manager import ProviderManager
from ml_service.services.generation import SchemaGenerationService


def test_provider_catalog_and_readiness_checks_reflect_runtime_state(client):
    providers_response = client.get("/v1/providers")
    assert providers_response.status_code == 200
    providers_payload = providers_response.json()["data"]
    assert any(item["id"] == "gemini" and item["enabled"] is False for item in providers_payload)
    assert any(item["id"] == "local_render" for item in providers_payload)

    ready_response = client.get("/health/ready")
    assert ready_response.status_code == 200
    ready_payload = ready_response.json()
    assert any(check["name"] == "provider:gemini" for check in ready_payload["checks"])


def test_chat_and_embeddings_fallback_between_gemini_and_ollama(client, monkeypatch, json_log_capture):
    async def gemini_chat(*args, **kwargs):
        raise ProviderError("gemini unavailable")

    async def ollama_chat(*args, **kwargs):
        return TextGenerationResult(
            text='{"title":"Fallback title","summary":"Fallback summary"}',
            provider="ollama",
            model="llama3.2",
            usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        )

    async def ollama_chat_fail(*args, **kwargs):
        raise ProviderError("ollama unavailable")

    async def gemini_chat_ok(*args, **kwargs):
        return TextGenerationResult(
            text="Recovered via Gemini",
            provider="gemini",
            model="gemini-2.5-flash",
            usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        )

    async def gemini_embed_fail(*args, **kwargs):
        raise ProviderError("gemini embeddings unavailable")

    async def ollama_embed_ok(*args, **kwargs):
        return EmbeddingResult(
            vectors=[[0.1, 0.2, 0.3]],
            provider="ollama",
            model="nomic-embed-text",
            usage={"prompt_tokens": 1, "total_tokens": 1},
        )

    monkeypatch.setattr(client.app.state.provider_manager.gemini, "enabled", lambda: True)
    monkeypatch.setattr(client.app.state.provider_manager.ollama, "enabled", lambda: True)
    monkeypatch.setattr(client.app.state.provider_manager.gemini, "chat", gemini_chat)
    monkeypatch.setattr(client.app.state.provider_manager.ollama, "chat", ollama_chat)
    monkeypatch.setattr(client.app.state.provider_manager.gemini, "embed", gemini_embed_fail)
    monkeypatch.setattr(client.app.state.provider_manager.ollama, "embed", ollama_embed_ok)

    with json_log_capture("ml_service.providers.manager", "ml_service.app") as stream:
        chat_response = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "Create title and summary"}],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "type": "object",
                        "required": ["title", "summary"],
                        "properties": {"title": {"type": "string"}, "summary": {"type": "string"}},
                    },
                },
            },
        )
        embeddings_response = client.post("/v1/embeddings", json={"input": "fallback me", "dimensions": 3})

    assert chat_response.status_code == 200
    assert chat_response.json()["provider"] == "ollama"
    assert embeddings_response.status_code == 200
    assert embeddings_response.json()["provider"] == "ollama"
    log_payloads = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    assert any(payload.get("fallback_used") for payload in log_payloads)

    monkeypatch.setattr(client.app.state.provider_manager.ollama, "chat", ollama_chat_fail)
    monkeypatch.setattr(client.app.state.provider_manager.gemini, "chat", gemini_chat_ok)

    with json_log_capture("ml_service.providers.manager", "ml_service.app") as stream:
        explicit_response = client.post(
            "/v1/chat/completions",
            json={
                "provider": "ollama",
                "model": "text-local",
                "messages": [{"role": "user", "content": "Recover through peer fallback"}],
            },
        )

    assert explicit_response.status_code == 200
    assert explicit_response.json()["provider"] == "gemini"
    log_payloads = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    assert any(payload.get("provider") == "gemini" for payload in log_payloads)


def test_streaming_chat_uses_provider_stream_and_emits_done(client, monkeypatch):
    async def fake_stream_chat(messages, *, provider, model_alias, options):
        del messages, provider, model_alias, options
        yield "Hello"
        yield " world"

    async def fail_chat(*args, **kwargs):
        raise AssertionError("non-stream chat fallback should not be used")

    monkeypatch.setattr(client.app.state.provider_manager, "stream_chat", fake_stream_chat)
    monkeypatch.setattr(client.app.state.provider_manager, "chat", fail_chat)

    response = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "stream please"}], "stream": True},
    )

    assert response.status_code == 200
    assert "Hello" in response.text
    assert "world" in response.text
    assert "[DONE]" in response.text


def test_unsupported_capabilities_return_400(client):
    transcription_response = client.post(
        "/v1/audio/transcriptions",
        data={"diarization": "true"},
        files={"file": ("clip.wav", b"RIFF", "audio/wav")},
    )
    assert transcription_response.status_code == 400
    assert transcription_response.json()["code"] == "unsupported_capability"

    speech_response = client.post(
        "/v1/audio/speech",
        json={"text": "Style me", "style": "dramatic"},
    )
    assert speech_response.status_code == 400
    assert speech_response.json()["code"] == "unsupported_capability"


def test_template_defaults_and_constraints_are_applied(client):
    generator = SchemaGenerationService(client.app.state.settings, client.app.state.provider_manager)

    presentation_payload, _ = generator.prepare_task_payload("presentation", {"slide_count_hint": 999})
    assert presentation_payload["slide_count_hint"] == 40
    assert presentation_payload["include_speaker_notes"] is True

    compare_payload, compare_template = generator.prepare_task_payload("compare", {})
    assert compare_payload["mode"] == "pairwise"
    assert compare_template["id"] == "compare.default.v1"


def test_rerender_segment_updates_audio_artifact_id(client, monkeypatch):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, speaking_rate
        mime_type = "audio/mpeg" if output_format == "mp3" else "audio/wav"
        return SynthesisResult(
            payload=b"ID3stub-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type=mime_type,
            duration_ms=900,
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
                        "text": "Welcome to the show",
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
        json={"output_format": "mp3"},
    )
    assert rerender_response.status_code == 202
    job_id = rerender_response.json()["job"]["id"]

    job_payload = None
    for _ in range(30):
        job_response = client.get(f"/v1/jobs/{job_id}")
        assert job_response.status_code == 200
        job_payload = job_response.json()
        if job_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert job_payload is not None
    assert job_payload["status"] == "completed"

    project_response = client.get(f"/v1/projects/{project_id}")
    assert project_response.status_code == 200
    segment = project_response.json()["segments"][0]
    assert segment["audio_artifact_id"]


def test_structured_logs_include_request_and_artifact_context(client, monkeypatch, json_log_capture):
    async def fake_synthesize(self, text, *, provider, voice_id, output_format, speaking_rate):
        del self, text, provider, voice_id, output_format, speaking_rate
        return SynthesisResult(
            payload=b"ID3stub-audio",
            provider="fake-tts",
            model="fake-voice",
            mime_type="audio/mpeg",
            duration_ms=1200,
        )

    monkeypatch.setattr(ProviderManager, "synthesize", fake_synthesize)

    with json_log_capture("ml_service.app", "ml_service.services.platform") as stream:
        response = client.post("/v1/audio/speech", json={"text": "log me", "execution": {"mode": "sync"}})

    assert response.status_code == 200
    log_payloads = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
    request_logs = [payload for payload in log_payloads if payload.get("message") == "Request completed"]
    artifact_logs = [payload for payload in log_payloads if payload.get("message") == "Artifact persisted"]
    assert any("route" in payload and "latency_ms" in payload for payload in request_logs)
    assert any(payload.get("artifact_ids") for payload in artifact_logs)
