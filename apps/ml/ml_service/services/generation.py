from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import yaml

from ml_service.core.config import Settings
from ml_service.providers.base import ProviderError
from ml_service.providers.manager import ProviderManager
from ml_service.providers.text import repair_json
from ml_service.services.heuristics import summarize_text


class SchemaGenerationService:
    def __init__(self, settings: Settings, provider_manager: ProviderManager) -> None:
        self.settings = settings
        self.provider_manager = provider_manager
        self._templates_cache: list[dict[str, Any]] | None = None

    def load_templates(self) -> list[dict[str, Any]]:
        if self._templates_cache is None:
            rows = []
            for path in sorted(self.settings.templates_path.glob("*.yaml")):
                with path.open("r", encoding="utf-8") as handle:
                    rows.append(yaml.safe_load(handle))
            self._templates_cache = rows
        return copy.deepcopy(self._templates_cache)

    def resolve_template(self, kind: str, template_id: str | None = None) -> dict[str, Any]:
        templates = self.load_templates()
        if template_id:
            for template in templates:
                if template.get("id") == template_id:
                    return template
        candidates = [template for template in templates if template.get("kind") == kind]
        if candidates:
            candidates.sort(key=lambda item: (0 if "default" in str(item.get("id", "")) else 1, str(item.get("id", ""))))
            return candidates[0]
        return {
            "id": f"{kind}.default",
            "kind": kind,
            "version": "1.0",
            "system_prompt": "",
            "instructions": "",
            "defaults": {},
            "schema": {},
            "constraints": {},
        }

    def prepare_task_payload(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        template_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        template = self.resolve_template(kind, template_id or payload.get("template_id"))
        merged = self.merge_missing(payload, template.get("defaults") or {})
        return self.apply_template_constraints(kind, merged, template.get("constraints") or {}), template

    async def build_task_response(
        self,
        kind: str,
        payload: dict[str, Any],
        template: dict[str, Any],
        draft_response: dict[str, Any],
    ) -> dict[str, Any]:
        response = await self._generate_structured_payload(kind, payload, template, draft_response, restrict_to_draft_keys=True)
        output_schema = payload.get("output_schema")
        if output_schema and isinstance(output_schema, dict):
            coerced = self.coerce_to_schema(response, output_schema, json.dumps(response, ensure_ascii=True))
            if isinstance(coerced, dict):
                response = self._deep_merge(response, self._filter_known_response_keys(draft_response, coerced))
        return response

    async def build_project_payload(
        self,
        kind: str,
        payload: dict[str, Any],
        template: dict[str, Any],
        draft_payload: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._generate_structured_payload(kind, payload, template, draft_payload, restrict_to_draft_keys=False)

    def merge_generation_options(self, payload: dict[str, Any]) -> dict[str, Any]:
        generation = copy.deepcopy(payload.get("generation") or {})
        if generation.get("provider") is None and payload.get("provider"):
            generation["provider"] = payload.get("provider")
        if generation.get("model") is None and payload.get("model"):
            generation["model"] = payload.get("model")
        if generation.get("temperature") is None and payload.get("temperature") is not None:
            generation["temperature"] = payload.get("temperature")
        if generation.get("top_p") is None and payload.get("top_p") is not None:
            generation["top_p"] = payload.get("top_p")
        if generation.get("max_output_tokens") is None:
            if payload.get("max_output_tokens") is not None:
                generation["max_output_tokens"] = payload.get("max_output_tokens")
            elif payload.get("max_tokens") is not None:
                generation["max_output_tokens"] = payload.get("max_tokens")
        return generation

    def parse_possible_json(self, value: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return {}
        if stripped.startswith("{") or stripped.startswith("[") or stripped.startswith("```"):
            try:
                return repair_json(stripped)
            except Exception:  # noqa: BLE001
                return stripped
        return stripped

    def coerce_to_schema(self, value: Any, schema: dict[str, Any], context_text: str = "") -> Any:
        if not schema:
            return value
        schema_type = schema.get("type")
        if not schema_type and "properties" in schema:
            schema_type = "object"
        if schema_type == "object":
            source = value if isinstance(value, dict) else {}
            properties = schema.get("properties") or {}
            required = set(schema.get("required") or [])
            output: dict[str, Any] = {}
            for key, child_schema in properties.items():
                current = source.get(key)
                if current is None and key not in required and not context_text:
                    continue
                child = self.coerce_to_schema(current, child_schema, context_text)
                if child is None and key not in required:
                    continue
                output[key] = child
            return output
        if schema_type == "array":
            item_schema = schema.get("items") or {}
            if isinstance(value, list):
                return [self.coerce_to_schema(item, item_schema, context_text) for item in value]
            if context_text and item_schema.get("type") == "string":
                return [summarize_text(context_text, 1)]
            return []
        if schema_type == "string":
            if isinstance(value, str):
                return value
            if value is not None:
                return json.dumps(value, ensure_ascii=True)
            return summarize_text(context_text, 1) if context_text else schema.get("default", "")
        if schema_type == "integer":
            try:
                return int(value or 0)
            except (TypeError, ValueError):
                return int(schema.get("default", 0))
        if schema_type == "number":
            try:
                return float(value or 0.0)
            except (TypeError, ValueError):
                return float(schema.get("default", 0.0))
        if schema_type == "boolean":
            if isinstance(value, bool):
                return value
            return bool(schema.get("default", False))
        return value

    def merge_missing(self, payload: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
        merged = copy.deepcopy(payload)
        for key, value in defaults.items():
            current = merged.get(key)
            if key not in merged or current is None or current == [] or current == {}:
                merged[key] = copy.deepcopy(value)
            elif isinstance(current, dict) and isinstance(value, dict):
                merged[key] = self.merge_missing(current, value)
        return merged

    def apply_template_constraints(self, kind: str, payload: dict[str, Any], constraints: dict[str, Any]) -> dict[str, Any]:
        normalized = copy.deepcopy(payload)
        if kind == "chat_rag" and constraints.get("max_sources") and normalized.get("max_sources"):
            normalized["max_sources"] = min(int(normalized["max_sources"]), int(constraints["max_sources"]))
        if kind == "mindmap" and constraints.get("max_depth") and normalized.get("max_depth"):
            normalized["max_depth"] = min(int(normalized["max_depth"]), int(constraints["max_depth"]))
        if kind == "presentation" and constraints.get("max_slide_count") and normalized.get("slide_count_hint"):
            normalized["slide_count_hint"] = min(int(normalized["slide_count_hint"]), int(constraints["max_slide_count"]))
        if kind == "table" and constraints.get("max_rows_soft") and normalized.get("max_rows"):
            normalized["max_rows"] = min(int(normalized["max_rows"]), int(constraints["max_rows_soft"]))
        return normalized

    async def _generate_structured_payload(
        self,
        kind: str,
        payload: dict[str, Any],
        template: dict[str, Any],
        draft: dict[str, Any],
        *,
        restrict_to_draft_keys: bool,
    ) -> dict[str, Any]:
        generation = self.merge_generation_options(payload)
        if not generation:
            return draft
        schema = payload.get("output_schema") or template.get("schema") or {}
        messages = self._build_structured_messages(kind, payload, template, draft, schema)
        try:
            result = await self.provider_manager.chat(
                messages,
                provider=generation.get("provider", "auto"),
                model_alias=generation.get("model", "text-default"),
                options=generation,
            )
        except ProviderError:
            if self.settings.allow_stub_generators:
                return draft
            raise
        if result.provider == "heuristic":
            return draft
        parsed = self.parse_possible_json(result.text)
        if not isinstance(parsed, dict):
            parsed = self.coerce_to_schema(parsed, schema, result.text)
        if not isinstance(parsed, dict):
            return draft
        overlay = self._filter_known_response_keys(draft, parsed) if restrict_to_draft_keys else parsed
        return self._deep_merge(draft, overlay)

    def _build_structured_messages(
        self,
        kind: str,
        payload: dict[str, Any],
        template: dict[str, Any],
        draft: dict[str, Any],
        schema: dict[str, Any],
    ) -> list[dict[str, Any]]:
        system_parts = [
            template.get("system_prompt") or "",
            template.get("instructions") or "",
            "Return valid JSON only. Do not wrap the response in markdown fences.",
        ]
        return [
            {"role": "system", "content": "\n".join(part for part in system_parts if part).strip()},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task_kind": kind,
                        "request": payload,
                        "desired_schema": schema,
                        "draft_result": draft,
                    },
                    ensure_ascii=True,
                    indent=2,
                ),
            },
        ]

    def _filter_known_response_keys(self, draft: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in overlay.items() if key in draft}

    def _deep_merge(self, current: Any, patch: Any) -> Any:
        if isinstance(current, dict) and isinstance(patch, dict):
            merged = dict(current)
            for key, value in patch.items():
                merged[key] = self._deep_merge(merged.get(key), value)
            return merged
        return patch if patch is not None else current
