from __future__ import annotations

import asyncio
import importlib.util
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ml_service.core.config import Settings
from ml_service.providers.base import EmbeddingResult, ProviderAvailability, ProviderError, TextGenerationResult


class HttpProviderMixin:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @retry(
        retry=retry_if_exception_type((httpx.HTTPError, ProviderError)),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=5),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            response = await client.request(method, url, headers=headers, json=json_payload)
            response.raise_for_status()
            return response.json()

    async def _stream_request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
            async with client.stream(method, url, headers=headers, json=json_payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    yield line


class GeminiProvider(HttpProviderMixin):
    provider_id = "gemini"

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.gemini_api_key:
            return ProviderAvailability(self.provider_id, False, "GEMINI_API_KEY is not configured.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        return {"text_generation", "structured_generation", "embeddings", "streaming"}

    def _content_payload(self, messages: list[dict[str, Any]], options: dict[str, Any]) -> dict[str, Any]:
        contents = []
        for message in messages:
            role = "model" if message.get("role") == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": str(message.get("content", ""))}]})
        return {
            "contents": contents,
            "generationConfig": {
                "temperature": options.get("temperature", 0.2),
                "topP": options.get("top_p", 0.8),
                "maxOutputTokens": options.get("max_output_tokens") or options.get("max_tokens") or 1024,
            },
        }

    async def chat(self, messages: list[dict[str, Any]], model: str, options: dict[str, Any]) -> TextGenerationResult:
        if not self.enabled():
            raise ProviderError("Gemini is not configured.")
        response = await self._request(
            "POST",
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.settings.gemini_api_key}",
            json_payload=self._content_payload(messages, options),
        )
        parts = response.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = "".join(str(part.get("text", "")) for part in parts).strip()
        usage = response.get("usageMetadata", {})
        return TextGenerationResult(
            text=text,
            provider=self.provider_id,
            model=model,
            usage={
                "prompt_tokens": usage.get("promptTokenCount", 0),
                "completion_tokens": usage.get("candidatesTokenCount", 0),
                "total_tokens": usage.get("totalTokenCount", 0),
            },
        )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        options: dict[str, Any],
    ) -> AsyncIterator[str]:
        if not self.enabled():
            raise ProviderError("Gemini is not configured.")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={self.settings.gemini_api_key}"
        async for line in self._stream_request("POST", url, json_payload=self._content_payload(messages, options)):
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            parts = chunk.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            token = "".join(str(part.get("text", "")) for part in parts)
            if token:
                yield token

    async def embed(
        self,
        inputs: list[str],
        model: str,
        *,
        task_type: str | None = None,
        dimensions: int | None = None,
    ) -> EmbeddingResult:
        if not self.enabled():
            raise ProviderError("Gemini embeddings are not configured.")
        gemini_task_type = {
            "retrieval_query": "RETRIEVAL_QUERY",
            "retrieval_document": "RETRIEVAL_DOCUMENT",
            "semantic_similarity": "SEMANTIC_SIMILARITY",
            "classification": "CLASSIFICATION",
            "clustering": "CLUSTERING",
        }.get(task_type or "", "RETRIEVAL_DOCUMENT")

        async def embed_one(text: str) -> tuple[list[float], int]:
            json_payload: dict[str, Any] = {
                "content": {"parts": [{"text": text}]},
                "taskType": gemini_task_type,
            }
            if dimensions:
                json_payload["outputDimensionality"] = dimensions
            response = await self._request(
                "POST",
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={self.settings.gemini_api_key}",
                json_payload=json_payload,
            )
            usage = response.get("usageMetadata", {})
            return [float(value) for value in response.get("embedding", {}).get("values", [])], int(usage.get("promptTokenCount", 0))

        results = await asyncio.gather(*(embed_one(text) for text in inputs))
        return EmbeddingResult(
            vectors=[vector for vector, _ in results],
            provider=self.provider_id,
            model=model,
            usage={"prompt_tokens": sum(tokens for _, tokens in results), "total_tokens": sum(tokens for _, tokens in results)},
        )


class OllamaProvider(HttpProviderMixin):
    provider_id = "ollama"

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.ollama_base_url:
            return ProviderAvailability(self.provider_id, False, "OLLAMA_BASE_URL is not configured.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        return {"text_generation", "structured_generation", "embeddings", "streaming"}

    async def chat(self, messages: list[dict[str, Any]], model: str, options: dict[str, Any]) -> TextGenerationResult:
        response = await self._request(
            "POST",
            f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
            json_payload={
                "model": model,
                "stream": False,
                "messages": [{"role": msg["role"], "content": msg.get("content", "")} for msg in messages],
                "options": {
                    "temperature": options.get("temperature", 0.2),
                    "top_p": options.get("top_p", 0.8),
                    "num_predict": options.get("max_output_tokens") or options.get("max_tokens") or 1024,
                },
            },
        )
        return TextGenerationResult(
            text=str(response.get("message", {}).get("content", "")).strip(),
            provider=self.provider_id,
            model=model,
            usage={
                "prompt_tokens": int(response.get("prompt_eval_count", 0)),
                "completion_tokens": int(response.get("eval_count", 0)),
                "total_tokens": int(response.get("prompt_eval_count", 0)) + int(response.get("eval_count", 0)),
            },
        )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        options: dict[str, Any],
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "stream": True,
            "messages": [{"role": msg["role"], "content": msg.get("content", "")} for msg in messages],
            "options": {
                "temperature": options.get("temperature", 0.2),
                "top_p": options.get("top_p", 0.8),
                "num_predict": options.get("max_output_tokens") or options.get("max_tokens") or 1024,
            },
        }
        async for line in self._stream_request(
            "POST",
            f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
            json_payload=payload,
        ):
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue
            if chunk.get("done"):
                continue
            token = str(chunk.get("message", {}).get("content", ""))
            if token:
                yield token

    async def embed(
        self,
        inputs: list[str],
        model: str,
        *,
        task_type: str | None = None,
        dimensions: int | None = None,
    ) -> EmbeddingResult:
        del task_type
        batch_url = f"{self.settings.ollama_base_url.rstrip('/')}/api/embed"
        try:
            response = await self._request("POST", batch_url, json_payload={"model": model, "input": inputs})
            vectors = [[float(value) for value in item] for item in response.get("embeddings", [])]
        except Exception:  # noqa: BLE001
            vectors = []
            for text in inputs:
                response = await self._request(
                    "POST",
                    f"{self.settings.ollama_base_url.rstrip('/')}/api/embeddings",
                    json_payload={"model": model, "prompt": text},
                )
                vectors.append([float(value) for value in response.get("embedding", [])])
        if dimensions:
            vectors = [vector[:dimensions] for vector in vectors]
        return EmbeddingResult(vectors=vectors, provider=self.provider_id, model=model, usage={})


class OpenAICompatibleProvider(HttpProviderMixin):
    provider_id = "openai_compatible"

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.openai_compatible_base_url:
            return ProviderAvailability(self.provider_id, False, "CENTRINVEST_LLM_URL is not configured.", self.supported_capabilities())
        if not self.settings.openai_compatible_api_key:
            return ProviderAvailability(self.provider_id, False, "CENTRINVEST_API_KEY is not configured.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        return {"text_generation", "structured_generation", "embeddings", "streaming"}

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.openai_compatible_api_key}",
            "Content-Type": "application/json",
        }

    async def chat(self, messages: list[dict[str, Any]], model: str, options: dict[str, Any]) -> TextGenerationResult:
        if not self.enabled():
            raise ProviderError("OpenAI-compatible provider is not configured.")
        response = await self._request(
            "POST",
            f"{self.settings.openai_compatible_base_url.rstrip('/')}/chat/completions",
            headers=self._headers(),
            json_payload={
                "model": model,
                "messages": messages,
                "temperature": options.get("temperature", 0.2),
                "top_p": options.get("top_p", 0.8),
                "max_tokens": options.get("max_output_tokens") or options.get("max_tokens") or 1024,
            },
        )
        choice = response.get("choices", [{}])[0]
        return TextGenerationResult(
            text=str(choice.get("message", {}).get("content", "")).strip(),
            provider=self.provider_id,
            model=model,
            usage=response.get("usage", {}),
        )

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        options: dict[str, Any],
    ) -> AsyncIterator[str]:
        if not self.enabled():
            raise ProviderError("OpenAI-compatible provider is not configured.")
        async for line in self._stream_request(
            "POST",
            f"{self.settings.openai_compatible_base_url.rstrip('/')}/chat/completions",
            headers=self._headers(),
            json_payload={
                "model": model,
                "messages": messages,
                "stream": True,
                "temperature": options.get("temperature", 0.2),
                "top_p": options.get("top_p", 0.8),
                "max_tokens": options.get("max_output_tokens") or options.get("max_tokens") or 1024,
            },
        ):
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            token = str(delta.get("content", ""))
            if token:
                yield token

    async def embed(
        self,
        inputs: list[str],
        model: str,
        *,
        task_type: str | None = None,
        dimensions: int | None = None,
    ) -> EmbeddingResult:
        del task_type
        if not self.enabled():
            raise ProviderError("OpenAI-compatible embeddings are not configured.")
        base_url = self.settings.openai_compatible_embeddings_url or self.settings.openai_compatible_base_url
        json_payload: dict[str, Any] = {"model": model, "input": inputs}
        if dimensions:
            json_payload["dimensions"] = dimensions
        response = await self._request(
            "POST",
            f"{base_url.rstrip('/')}/embeddings",
            headers=self._headers(),
            json_payload=json_payload,
        )
        vectors = [[float(value) for value in item.get("embedding", [])] for item in response.get("data", [])]
        return EmbeddingResult(vectors=vectors, provider=self.provider_id, model=model, usage=response.get("usage", {}))


class HeuristicProvider:
    provider_id = "heuristic"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def enabled(self) -> bool:
        return self.readiness().available

    def readiness(self) -> ProviderAvailability:
        if not self.settings.allow_stub_generators:
            return ProviderAvailability(self.provider_id, False, "Stub generators are disabled.", self.supported_capabilities())
        return ProviderAvailability(self.provider_id, True, capabilities=self.supported_capabilities())

    def supported_capabilities(self) -> set[str]:
        return {"text_generation", "structured_generation", "embeddings", "streaming"}

    async def chat(self, messages: list[dict[str, Any]], model: str, options: dict[str, Any]) -> TextGenerationResult:
        relevant = [str(message.get("content", "")).strip() for message in messages if str(message.get("content", "")).strip()]
        text = "\n".join(relevant[-3:]).strip()
        if not text:
            text = "No content provided."
        return TextGenerationResult(
            text=text[: options.get("max_output_tokens", 1024)],
            provider=self.provider_id,
            model=model,
            usage={"prompt_tokens": len(text.split()), "completion_tokens": len(text.split()), "total_tokens": len(text.split()) * 2},
        )

    async def embed(
        self,
        inputs: list[str],
        model: str,
        *,
        task_type: str | None = None,
        dimensions: int | None = None,
    ) -> EmbeddingResult:
        del task_type
        vectors: list[list[float]] = []
        dimensions = dimensions or self.settings.embedding_dimensions
        for text in inputs:
            bucket = [0.0] * dimensions
            for index, token in enumerate(text.split()):
                bucket[index % dimensions] += float((sum(ord(char) for char in token) % 1000) / 1000)
            vectors.append(bucket)
        return EmbeddingResult(vectors=vectors, provider=self.provider_id, model=model, usage={})

    async def stream_chat(
        self,
        messages: list[dict[str, Any]],
        model: str,
        options: dict[str, Any],
    ) -> AsyncIterator[str]:
        result = await self.chat(messages, model, options)
        for token in result.text.split():
            yield token + " "


def repair_json(payload: str) -> dict[str, Any]:
    cleaned = payload.strip().strip("`")
    if cleaned.startswith("json"):
        cleaned = cleaned[4:].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ProviderError(f"Unable to parse structured output: {error}") from error


def module_is_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None
