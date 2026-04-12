from __future__ import annotations

from pathlib import Path

import yaml


def test_all_openapi_paths_are_registered(client):
    spec_path = Path(__file__).resolve().parents[3] / "ai-service-openapi.yaml"
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    expected_paths = set(spec["paths"].keys())
    registered_paths = {route.path for route in client.app.router.routes}
    missing = expected_paths - registered_paths
    assert not missing, f"Missing routes: {sorted(missing)}"
