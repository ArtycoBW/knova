from __future__ import annotations

from ml_service.core.config import Settings
from ml_service.storage.base import ArtifactStorage
from ml_service.storage.local import LocalArtifactStorage


def build_artifact_storage(settings: Settings) -> ArtifactStorage:
    backend = settings.storage_backend.lower()
    if backend == "s3":
        from ml_service.storage.s3 import S3ArtifactStorage

        return S3ArtifactStorage(settings)
    return LocalArtifactStorage(settings.artifacts_path)
