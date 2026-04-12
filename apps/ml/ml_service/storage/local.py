from __future__ import annotations

from pathlib import Path

from ml_service.storage.base import StorageWriteResult, checksum_bytes


class LocalArtifactStorage:
    backend_name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, storage_uri: str) -> Path:
        relative_path = storage_uri.replace("file://", "", 1)
        return self.root / relative_path

    def write_bytes(self, relative_path: str, payload: bytes) -> StorageWriteResult:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return StorageWriteResult(
            storage_uri=f"file://{relative_path}",
            checksum=checksum_bytes(payload),
            size=len(payload),
        )

    def write_text(self, relative_path: str, payload: str) -> StorageWriteResult:
        return self.write_bytes(relative_path, payload.encode("utf-8"))

    def read_bytes(self, storage_uri: str) -> bytes:
        return self.resolve(storage_uri).read_bytes()

    def exists(self, storage_uri: str) -> bool:
        return self.resolve(storage_uri).exists()

    def healthcheck(self) -> dict[str, object]:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            return {"status": "ok", "details": {"backend": self.backend_name, "path": str(self.root)}}
        except Exception as error:  # noqa: BLE001
            return {"status": "failed", "details": {"backend": self.backend_name, "message": str(error)}}
