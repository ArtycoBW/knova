from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
import shutil
from typing import Any, TypeVar

from ml_service.core.circuit_breaker import CircuitBreaker
from ml_service.core.config import Settings
from ml_service.core.logging import get_logger
from ml_service.providers.base import EmbeddingResult, ProviderAvailability, ProviderError, SynthesisResult, TextGenerationResult, TranscriptionResult, UnsupportedCapabilityError
from ml_service.providers.stt import LocalWhisperProvider, OpenAICompatibleSttProvider
from ml_service.providers.text import GeminiProvider, HeuristicProvider, OllamaProvider, OpenAICompatibleProvider
from ml_service.providers.tts import EdgeTtsProvider, PiperTtsProvider


logger = get_logger(__name__)
T = TypeVar("T")


class ProviderManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.gemini = GeminiProvider(settings)
        self.ollama = OllamaProvider(settings)
        self.openai_compatible = OpenAICompatibleProvider(settings)
        self.heuristic = HeuristicProvider(settings)
        self.local_stt = LocalWhisperProvider(settings)
        self.compat_stt = OpenAICompatibleSttProvider(settings)
        self.piper = PiperTtsProvider(settings)
        self.edge = EdgeTtsProvider(settings)
        self.circuit_breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=30)

    def providers_catalog(self) -> list[dict[str, Any]]:
        rows = []
        for spec in self._provider_specs():
            readiness = self._provider_readiness(spec["name"])
            rows.append(
                {
                    "id": spec["id"],
                    "kind": spec["kind"],
                    "enabled": readiness.available,
                    "routing_group": spec["routing_group"],
                    "capabilities": sorted(readiness.capabilities),
                    "default_model_aliases": spec["default_model_aliases"],
                }
            )
        return rows

    def provider_health_checks(self) -> list[dict[str, Any]]:
        checks = []
        for spec in self._provider_specs():
            readiness = self._provider_readiness(spec["name"])
            checks.append(
                {
                    "name": f"provider:{spec['id']}",
                    "status": "ok" if readiness.available else "degraded",
                    "details": {
                        "kind": spec["kind"],
                        "routing_group": spec["routing_group"],
                        "capabilities": sorted(readiness.capabilities),
                        "reason": readiness.reason,
                    },
                }
            )
        return checks

    def model_catalog(self) -> list[dict[str, Any]]:
        aliases = self.settings.model_aliases()
        rows: list[dict[str, Any]] = []
        for alias, payload in aliases.items():
            rows.append(
                {
                    "id": payload["model"],
                    "alias": alias,
                    "provider": payload["provider"],
                    "modality": payload["modality"],
                    "capabilities": [payload["modality"]],
                    "recommended_for": [alias],
                    "dimensions": payload.get("dimensions"),
                }
            )
        return rows

    def capability_available(
        self,
        capability: str,
        *,
        provider: str = "auto",
        alias_provider: str | None = None,
        candidates: list[str] | None = None,
    ) -> bool:
        for provider_name in self._ordered_provider_names(provider, alias_provider, candidates or []):
            readiness = self._provider_readiness(provider_name)
            if readiness.available and capability in readiness.capabilities:
                return True
        return False

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        provider: str = "auto",
        model_alias: str = "text-default",
        options: dict[str, Any] | None = None,
    ) -> TextGenerationResult:
        options = options or {}
        alias = self.settings.model_aliases().get(model_alias, {})
        resolved_model = self._resolve_model_name(model_alias, options.get("model"), alias.get("model") or self.settings.gemini_model)
        provider_order = self._ordered_provider_names(
            provider,
            alias.get("provider"),
            ["gemini", "ollama", "openai_compatible"],
            include_stub=self.settings.allow_stub_generators,
        )
        return await self._execute_with_fallback(
            capability="text_generation",
            provider_order=provider_order,
            runner=lambda provider_name: getattr(self, provider_name).chat(messages, resolved_model, options),
        )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        *,
        provider: str = "auto",
        model_alias: str = "text-default",
        options: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        options = options or {}
        alias = self.settings.model_aliases().get(model_alias, {})
        resolved_model = self._resolve_model_name(model_alias, options.get("model"), alias.get("model") or self.settings.gemini_model)
        provider_order = self._ordered_provider_names(
            provider,
            alias.get("provider"),
            ["gemini", "ollama", "openai_compatible"],
            include_stub=self.settings.allow_stub_generators,
        )
        last_error: Exception | None = None
        selected_provider = provider_order[0] if provider_order else None
        for provider_name in provider_order:
            if "streaming" not in self._provider_capabilities(provider_name):
                continue
            breaker_key = self._breaker_key(provider_name, "streaming")
            if self.circuit_breaker.is_open(breaker_key):
                self._log_fallback(provider_name, "streaming", "circuit_open")
                continue
            client = getattr(self, provider_name, None)
            if client is None or not client.enabled():
                continue
            try:
                async for chunk in client.stream_chat(messages, resolved_model, options):
                    yield chunk
                self.circuit_breaker.record_success(breaker_key)
                self._log_provider_resolution(provider_name, resolved_model, selected_provider, "streaming")
                return
            except Exception as error:  # noqa: BLE001
                self.circuit_breaker.record_failure(breaker_key)
                last_error = error
        raise ProviderError(str(last_error) if last_error else "No streaming text provider available.")

    async def embeddings(
        self,
        inputs: list[str],
        *,
        provider: str = "auto",
        model_alias: str = "embed-default",
        task_type: str | None = None,
        dimensions: int | None = None,
    ) -> EmbeddingResult:
        alias = self.settings.model_aliases().get(model_alias, {})
        resolved_model = alias.get("model") or (model_alias if model_alias not in self.settings.model_aliases() else None) or self.settings.gemini_embed_model
        provider_order = self._ordered_provider_names(
            provider,
            alias.get("provider"),
            ["gemini", "ollama", "openai_compatible"],
            include_stub=self.settings.allow_stub_generators,
        )
        return await self._execute_with_fallback(
            capability="embeddings",
            provider_order=provider_order,
            runner=lambda provider_name: getattr(self, provider_name).embed(
                inputs,
                resolved_model,
                task_type=task_type,
                dimensions=dimensions or alias.get("dimensions"),
            ),
        )

    async def transcribe(
        self,
        source_path,
        *,
        provider: str = "auto",
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
    ) -> TranscriptionResult:
        candidates = ["local_stt", "compat_stt"]
        if diarization and not self.capability_available("diarization", provider=provider, candidates=candidates):
            raise UnsupportedCapabilityError("diarization", "Diarization is not supported by configured STT providers.")
        if word_timestamps and not self.capability_available("word_timestamps", provider=provider, candidates=candidates):
            raise UnsupportedCapabilityError("word_timestamps", "Word timestamps are not supported by configured STT providers.")
        order = self._ordered_provider_names(provider, None, candidates)
        return await self._execute_with_fallback(
            capability="transcription",
            provider_order=order,
            runner=lambda provider_name: getattr(self, provider_name).transcribe(
                source_path,
                language=language,
                diarization=diarization,
                word_timestamps=word_timestamps,
            ),
        )

    async def synthesize(
        self,
        text: str,
        *,
        provider: str = "auto",
        voice_id: str | None = None,
        output_format: str = "mp3",
        speaking_rate: float = 1.0,
    ) -> SynthesisResult:
        order = self._ordered_provider_names(provider, None, ["piper", "edge"])
        return await self._execute_with_fallback(
            capability="speech_synthesis",
            provider_order=order,
            runner=lambda provider_name: getattr(self, provider_name).synthesize(
                text,
                voice_id=voice_id,
                output_format=output_format,
                speaking_rate=speaking_rate,
            ),
        )

    async def _execute_with_fallback(
        self,
        *,
        capability: str,
        provider_order: list[str],
        runner: Callable[[str], Awaitable[T]],
    ) -> T:
        last_error: Exception | None = None
        selected_provider = provider_order[0] if provider_order else None
        for provider_name in provider_order:
            if capability not in self._provider_capabilities(provider_name):
                continue
            breaker_key = self._breaker_key(provider_name, capability)
            if self.circuit_breaker.is_open(breaker_key):
                self._log_fallback(provider_name, capability, "circuit_open")
                continue
            client = getattr(self, provider_name, None)
            if client is None or not client.enabled():
                continue
            try:
                result = await runner(provider_name)
                self.circuit_breaker.record_success(breaker_key)
                self._log_provider_resolution(provider_name, getattr(result, "model", None), selected_provider, capability)
                return result
            except Exception as error:  # noqa: BLE001
                self.circuit_breaker.record_failure(breaker_key)
                last_error = error
        raise ProviderError(str(last_error) if last_error else f"No provider available for capability '{capability}'.")

    def _provider_specs(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "gemini",
                "name": "gemini",
                "kind": "text",
                "routing_group": "text_generation",
                "default_model_aliases": {"text-default": self.settings.gemini_model, "embed-default": self.settings.gemini_embed_model},
            },
            {
                "id": "ollama",
                "name": "ollama",
                "kind": "text",
                "routing_group": "text_generation",
                "default_model_aliases": {"text-local": self.settings.ollama_chat_model, "embed-local": self.settings.ollama_embed_model},
            },
            {
                "id": "openai_compatible",
                "name": "openai_compatible",
                "kind": "text",
                "routing_group": "legacy_compat",
                "default_model_aliases": {"legacy-text": self.settings.openai_compatible_model},
            },
            {
                "id": "local_stt",
                "name": "local_stt",
                "kind": "stt",
                "routing_group": "transcription",
                "default_model_aliases": {"stt-local": self.settings.whisper_model_size},
            },
            {
                "id": "openai_compatible_stt",
                "name": "compat_stt",
                "kind": "stt",
                "routing_group": "transcription",
                "default_model_aliases": {"stt-compatible": self.settings.openai_compatible_stt_model},
            },
            {
                "id": "piper",
                "name": "piper",
                "kind": "tts",
                "routing_group": "speech_synthesis",
                "default_model_aliases": {"tts-local": self.settings.piper_default_voice or "default"},
            },
            {
                "id": "edge_tts",
                "name": "edge",
                "kind": "tts",
                "routing_group": "speech_synthesis",
                "default_model_aliases": {"tts-fallback": self.settings.edge_tts_voice},
            },
            {
                "id": "local_render",
                "name": "local_render",
                "kind": "render",
                "routing_group": "media_render",
                "default_model_aliases": {"render-default": "ffmpeg"},
            },
        ]

    def _provider_readiness(self, provider_name: str) -> ProviderAvailability:
        if provider_name == "local_render":
            ffmpeg_available = shutil.which(self.settings.ffmpeg_binary) is not None
            libreoffice_available = shutil.which(self.settings.libreoffice_binary) is not None
            return ProviderAvailability(
                "local_render",
                ffmpeg_available,
                None if ffmpeg_available else f"Binary '{self.settings.ffmpeg_binary}' is not available.",
                capabilities={
                    "audio_render",
                    "video_render",
                    "presentation_export",
                    *(["document_conversion"] if libreoffice_available else []),
                },
            )
        provider = getattr(self, provider_name)
        return provider.readiness()

    def _provider_capabilities(self, provider_name: str) -> set[str]:
        readiness = self._provider_readiness(provider_name)
        return readiness.capabilities

    def _ordered_provider_names(
        self,
        requested: str,
        alias_provider: str | None,
        auto_order: list[str],
        *,
        include_stub: bool = False,
    ) -> list[str]:
        ordered: list[str] = []
        requested_name = self._normalize_provider_name(requested) if requested and requested != "auto" else None
        alias_name = self._normalize_provider_name(alias_provider) if alias_provider else None
        for provider_name in [requested_name, alias_name, *auto_order]:
            if provider_name and provider_name not in ordered:
                ordered.append(provider_name)
        if include_stub and self.settings.allow_stub_generators and "heuristic" not in ordered:
            ordered.append("heuristic")
        return ordered

    def _normalize_provider_name(self, provider_name: str | None) -> str | None:
        if provider_name is None:
            return None
        return {
            "gemini": "gemini",
            "ollama": "ollama",
            "openai_compatible": "openai_compatible",
            "centrinvest": "openai_compatible",
            "local_stt": "local_stt",
            "stt-local": "local_stt",
            "openai_compatible_stt": "compat_stt",
            "compat_stt": "compat_stt",
            "piper": "piper",
            "edge_tts": "edge",
            "edge": "edge",
            "heuristic": "heuristic",
        }.get(provider_name, provider_name)

    def _breaker_key(self, provider_name: str, capability: str) -> str:
        return f"{provider_name}:{capability}"

    def _resolve_model_name(self, model_alias: str, explicit_model: str | None, default_model: str) -> str:
        known_aliases = self.settings.model_aliases()
        if explicit_model and explicit_model not in known_aliases:
            return explicit_model
        return known_aliases.get(model_alias, {}).get("model") or default_model

    def _log_provider_resolution(
        self,
        provider_name: str,
        model: str | None,
        selected_provider: str | None,
        capability: str,
    ) -> None:
        logger.info(
            "Provider resolved",
            extra={
                "extra_payload": {
                    "provider": provider_name,
                    "model": model,
                    "capability": capability,
                    "fallback_used": selected_provider is not None and provider_name != selected_provider,
                }
            },
        )

    def _log_fallback(self, provider_name: str, capability: str, reason: str) -> None:
        logger.info(
            "Provider skipped",
            extra={
                "extra_payload": {
                    "provider": provider_name,
                    "capability": capability,
                    "fallback_used": True,
                    "reason": reason,
                }
            },
        )
