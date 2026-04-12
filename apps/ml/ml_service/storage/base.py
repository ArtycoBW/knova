from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class StorageWriteResult:
    storage_uri: str
    checksum: str
    size: int


def checksum_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


@runtime_checkable
class ArtifactStorage(Protocol):
    backend_name: str

    def write_bytes(self, relative_path: str, payload: bytes) -> StorageWriteResult:
        ...

    def read_bytes(self, storage_uri: str) -> bytes:
        ...

    def exists(self, storage_uri: str) -> bool:
        ...

    def healthcheck(self) -> dict[str, Any]:
        ...
