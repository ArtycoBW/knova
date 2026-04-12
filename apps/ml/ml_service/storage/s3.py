from __future__ import annotations

from urllib.parse import urlparse

import boto3

from ml_service.core.config import Settings
from ml_service.storage.base import StorageWriteResult, checksum_bytes


class S3ArtifactStorage:
    backend_name = "s3"

    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket or ""
        session = boto3.session.Session(
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region,
        )
        self.client = session.client("s3", endpoint_url=settings.s3_endpoint_url)

    def write_bytes(self, relative_path: str, payload: bytes) -> StorageWriteResult:
        self.client.put_object(Bucket=self.bucket, Key=relative_path, Body=payload)
        return StorageWriteResult(
            storage_uri=f"s3://{self.bucket}/{relative_path}",
            checksum=checksum_bytes(payload),
            size=len(payload),
        )

    def read_bytes(self, storage_uri: str) -> bytes:
        bucket, key = self._parse_storage_uri(storage_uri)
        response = self.client.get_object(Bucket=bucket, Key=key)
        body = response["Body"]
        if hasattr(body, "read"):
            payload = body.read()
        else:
            payload = body
        return bytes(payload)

    def exists(self, storage_uri: str) -> bool:
        bucket, key = self._parse_storage_uri(storage_uri)
        try:
            self.client.head_object(Bucket=bucket, Key=key)
        except Exception:  # noqa: BLE001
            return False
        return True

    def healthcheck(self) -> dict[str, object]:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return {"status": "ok", "details": {"backend": self.backend_name, "bucket": self.bucket}}
        except Exception as error:  # noqa: BLE001
            return {
                "status": "failed",
                "details": {"backend": self.backend_name, "bucket": self.bucket, "message": str(error)},
            }

    def _parse_storage_uri(self, storage_uri: str) -> tuple[str, str]:
        parsed = urlparse(storage_uri)
        bucket = parsed.netloc or self.bucket
        key = parsed.path.lstrip("/")
        return bucket, key
