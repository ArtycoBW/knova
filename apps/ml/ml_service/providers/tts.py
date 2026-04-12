from __future__ import annotations

import asyncio
import importlib.util
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

from ml_service.core.config import Settings
from ml_service.providers.base import ProviderAvailability, ProviderError, SynthesisResult


class PiperTtsProvider:
    provider_id = "piper"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.piper_default_voice:
            return ProviderAvailability(self.provider_id, False, "PIPER_DEFAULT_VOICE is not configured.", self.supported_capabilities())
        if not shutil.which(self.settings.piper_binary):
            return ProviderAvailability(self.provider_id, False, f"Binary '{self.settings.piper_binary}' is not available.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        capabilities = {"speech_synthesis", "speaking_rate", "audio_wav"}
        if shutil.which(self.settings.ffmpeg_binary):
            capabilities.add("audio_mp3")
        return capabilities

    async def synthesize(
        self,
        text: str,
        *,
        voice_id: str | None = None,
        output_format: str = "mp3",
        speaking_rate: float = 1.0,
    ) -> SynthesisResult:
        voice = voice_id or self.settings.piper_default_voice
        if not voice:
            raise ProviderError("Piper voice is not configured.")
        wav_path = Path(tempfile.mkstemp(suffix=".wav")[1])
        command = [
            self.settings.piper_binary,
            "--model",
            voice,
            "--output_file",
            str(wav_path),
            "--length_scale",
            str(max(0.3, 1 / max(speaking_rate, 0.1))),
        ]
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate(text.encode("utf-8"))
        if process.returncode != 0:
            raise ProviderError(stderr.decode("utf-8", errors="ignore") or "Piper synthesis failed.")
        try:
            payload = wav_path.read_bytes()
            duration_ms = _estimate_wav_duration_ms(wav_path)
            mime_type = "audio/wav"
            if output_format == "mp3":
                payload = _convert_audio(self.settings, wav_path, ".mp3", "audio/mpeg")
                mime_type = "audio/mpeg"
            return SynthesisResult(
                payload=payload,
                provider=self.provider_id,
                model=voice,
                mime_type=mime_type,
                duration_ms=duration_ms,
            )
        finally:
            if wav_path.exists():
                wav_path.unlink()


class EdgeTtsProvider:
    provider_id = "edge_tts"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if importlib.util.find_spec("edge_tts") is None:
            return ProviderAvailability(self.provider_id, False, "edge-tts is not installed.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        capabilities = {"speech_synthesis", "speaking_rate", "audio_mp3"}
        if shutil.which(self.settings.ffmpeg_binary):
            capabilities.add("audio_wav")
        return capabilities

    async def synthesize(
        self,
        text: str,
        *,
        voice_id: str | None = None,
        output_format: str = "mp3",
        speaking_rate: float = 1.0,
    ) -> SynthesisResult:
        try:
            import edge_tts
        except ImportError as error:
            raise ProviderError("edge-tts is not installed.") from error

        mp3_path = Path(tempfile.mkstemp(suffix=".mp3")[1])
        voice = voice_id or self.settings.edge_tts_voice
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=f"{int((speaking_rate - 1.0) * 100):+d}%",
        )
        await communicate.save(str(mp3_path))
        try:
            payload = mp3_path.read_bytes()
            mime_type = "audio/mpeg"
            duration_ms = 0
            if output_format == "wav":
                payload = _convert_audio(self.settings, mp3_path, ".wav", "audio/wav")
                mime_type = "audio/wav"
            return SynthesisResult(
                payload=payload,
                provider=self.provider_id,
                model=voice,
                mime_type=mime_type,
                duration_ms=duration_ms,
            )
        finally:
            if mp3_path.exists():
                mp3_path.unlink()


def _convert_audio(settings: Settings, input_path: Path, suffix: str, mime_type: str) -> bytes:
    output_path = Path(tempfile.mkstemp(suffix=suffix)[1])
    command = [settings.ffmpeg_binary, "-y", "-i", str(input_path), str(output_path)]
    subprocess.run(command, check=True, capture_output=True)
    try:
        return output_path.read_bytes()
    finally:
        if output_path.exists():
            output_path.unlink()


def _estimate_wav_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        frame_count = handle.getnframes()
        sample_rate = handle.getframerate() or 1
    return int(frame_count / sample_rate * 1000)
