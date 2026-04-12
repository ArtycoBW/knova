from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass(slots=True)
class TextGenerationResult:
    text: str
    provider: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class EmbeddingResult:
    vectors: list[list[float]]
    provider: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


@dataclass(slots=True)
class TranscriptionResult:
    text: str
    provider: str
    model: str
    language: str | None = None
    duration_ms: int | None = None
    segments: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class SynthesisResult:
    payload: bytes
    provider: str
    model: str
    mime_type: str
    duration_ms: int
    segments: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class ProviderAvailability:
    provider_id: str
    available: bool
    reason: str | None = None
    capabilities: set[str] = field(default_factory=set)


class ProviderError(RuntimeError):
    pass


class UnsupportedCapabilityError(ProviderError):
    def __init__(self, capability: str, message: str | None = None) -> None:
        self.capability = capability
        super().__init__(message or f"Capability '{capability}' is not supported by any configured provider.")


class TextProvider(Protocol):
    provider_id: str

    def enabled(self) -> bool: ...

    async def chat(self, messages: list[dict[str, Any]], model: str, options: dict[str, Any]) -> TextGenerationResult: ...

    def readiness(self) -> ProviderAvailability: ...

    def supported_capabilities(self) -> set[str]: ...


class StreamingTextProvider(TextProvider, Protocol):
    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        options: dict[str, Any],
    ) -> AsyncIterator[str]: ...


class EmbeddingProvider(Protocol):
    provider_id: str

    def enabled(self) -> bool: ...

    async def embed(self, inputs: list[str], model: str, **kwargs: Any) -> EmbeddingResult: ...

    def readiness(self) -> ProviderAvailability: ...

    def supported_capabilities(self) -> set[str]: ...


class SttProvider(Protocol):
    provider_id: str

    def enabled(self) -> bool: ...

    async def transcribe(
        self,
        source_path: Path,
        *,
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
    ) -> TranscriptionResult: ...

    def readiness(self) -> ProviderAvailability: ...

    def supported_capabilities(self) -> set[str]: ...


class TtsProvider(Protocol):
    provider_id: str

    def enabled(self) -> bool: ...

    async def synthesize(
        self,
        text: str,
        *,
        voice_id: str | None = None,
        output_format: str = "mp3",
        speaking_rate: float = 1.0,
    ) -> SynthesisResult: ...

    def readiness(self) -> ProviderAvailability: ...

    def supported_capabilities(self) -> set[str]: ...


class RenderProvider(Protocol):
    provider_id: str

    def enabled(self) -> bool: ...
