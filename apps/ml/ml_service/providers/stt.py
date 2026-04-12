from __future__ import annotations

import importlib.util
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx

from ml_service.core.config import Settings
from ml_service.providers.base import ProviderAvailability, ProviderError, TranscriptionResult


VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


class LocalWhisperProvider:
    provider_id = "local_stt"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if importlib.util.find_spec("faster_whisper") is None:
            return ProviderAvailability(self.provider_id, False, "faster-whisper is not installed.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        capabilities = {"transcription", "word_timestamps", "timestamps"}
        if shutil.which(self.settings.ffmpeg_binary):
            capabilities.add("video_input")
        return capabilities

    def _get_model(self):
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise ProviderError("faster-whisper is not installed.") from error
        self._model = WhisperModel(
            self.settings.whisper_model_size,
            device=self.settings.whisper_device,
            compute_type=self.settings.whisper_compute_type,
        )
        return self._model

    def _prepare_audio(self, source_path: Path) -> Path:
        if source_path.suffix.lower() not in VIDEO_EXTENSIONS:
            return source_path
        temp_audio = Path(tempfile.mkstemp(suffix=".wav")[1])
        command = [
            self.settings.ffmpeg_binary,
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-ac",
            str(self.settings.default_audio_channels),
            "-ar",
            str(self.settings.default_audio_sample_rate),
            str(temp_audio),
        ]
        subprocess.run(command, check=True, capture_output=True)
        return temp_audio

    async def transcribe(
        self,
        source_path: Path,
        *,
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
    ) -> TranscriptionResult:
        del diarization
        prepared = self._prepare_audio(source_path)
        model = self._get_model()
        try:
            segments, info = model.transcribe(
                str(prepared),
                language=language,
                word_timestamps=word_timestamps,
            )
            rows: list[dict[str, Any]] = []
            text_chunks: list[str] = []
            for index, segment in enumerate(segments):
                text_chunks.append(segment.text.strip())
                rows.append(
                    {
                        "id": f"seg_{index + 1}",
                        "start_ms": int(segment.start * 1000),
                        "end_ms": int(segment.end * 1000),
                        "speaker": None,
                        "text": segment.text.strip(),
                    }
                )
            duration_ms = rows[-1]["end_ms"] if rows else 0
            return TranscriptionResult(
                text=" ".join(chunk for chunk in text_chunks if chunk).strip(),
                provider=self.provider_id,
                model=self.settings.whisper_model_size,
                language=getattr(info, "language", language),
                duration_ms=duration_ms,
                segments=rows,
            )
        finally:
            if prepared != source_path and prepared.exists():
                prepared.unlink()


class OpenAICompatibleSttProvider:
    provider_id = "openai_compatible_stt"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.openai_compatible_stt_url:
            return ProviderAvailability(self.provider_id, False, "CENTRINVEST_STT_URL is not configured.", self.supported_capabilities())
        if not self.settings.openai_compatible_api_key:
            return ProviderAvailability(self.provider_id, False, "CENTRINVEST_API_KEY is not configured.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        return {"transcription", "timestamps"}

    async def transcribe(
        self,
        source_path: Path,
        *,
        language: str | None = None,
        diarization: bool = False,
        word_timestamps: bool = False,
    ) -> TranscriptionResult:
        if not self.enabled():
            raise ProviderError("OpenAI-compatible STT is not configured.")
        form_data = {
            "model": self.settings.openai_compatible_stt_model,
            "language": language or "",
            "response_format": "verbose_json",
        }
        headers = {"Authorization": f"Bearer {self.settings.openai_compatible_api_key}"}
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            with source_path.open("rb") as handle:
                response = await client.post(
                    f"{self.settings.openai_compatible_stt_url.rstrip('/')}/audio/transcriptions",
                    headers=headers,
                    data=form_data,
                    files={"file": (source_path.name, handle, "application/octet-stream")},
                )
                response.raise_for_status()
        data = response.json()
        return TranscriptionResult(
            text=data.get("text", ""),
            provider=self.provider_id,
            model=self.settings.openai_compatible_stt_model,
            language=data.get("language", language),
            duration_ms=data.get("duration_ms"),
            segments=data.get("segments", []),
        )
