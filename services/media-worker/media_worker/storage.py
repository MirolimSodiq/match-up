"""Object storage (S3 / MinIO) — boto3. Testlarda `LocalStorage` (papka) bilan almashtiriladi."""

from __future__ import annotations

import json
import mimetypes
import shutil
import time
from pathlib import Path
from typing import Protocol

from .errors import RetryableError

CONTENT_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".json": "application/json",
}
#: Natija kalitlari o'zgarmaydi (media_id bo'yicha) — CDN uzoq keshlaydi
IMMUTABLE = "public, max-age=31536000, immutable"


class Storage(Protocol):
    def download(self, bucket: str, key: str, dst: Path) -> int: ...
    def upload_file(self, src: Path, bucket: str, key: str) -> None: ...
    def get_json(self, bucket: str, key: str) -> dict | None: ...
    def put_json(self, bucket: str, key: str, data: dict) -> None: ...


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _retry(fn, attempts: int = 3, base: float = 0.5):
    """Vaqtinchalik storage xatolari uchun ichki qayta urinish (eksponensial)."""
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — botocore/urllib3 xatolari xilma-xil
            if getattr(e, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound", "AccessDenied"):
                raise
            if i == attempts - 1:
                raise RetryableError(f"storage: {e}") from e
            time.sleep(base * 2**i)


class S3Storage:
    def __init__(self, endpoint: str | None, region: str, access_key: str | None, secret_key: str | None, path_style: bool) -> None:
        import boto3
        from botocore.config import Config

        self.s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(
                s3={"addressing_style": "path" if path_style else "auto"},
                retries={"max_attempts": 5, "mode": "standard"},
                # MinIO va S3 bilan bir xil: checksum faqat talab qilinganda
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def download(self, bucket: str, key: str, dst: Path) -> int:
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".part")
        _retry(lambda: self.s3.download_file(bucket, key, str(tmp)))
        tmp.replace(dst)
        return dst.stat().st_size

    def upload_file(self, src: Path, bucket: str, key: str) -> None:
        extra = {"ContentType": content_type(src), "CacheControl": IMMUTABLE}
        _retry(lambda: self.s3.upload_file(str(src), bucket, key, ExtraArgs=extra))

    def get_json(self, bucket: str, key: str) -> dict | None:
        try:
            body = _retry(lambda: self.s3.get_object(Bucket=bucket, Key=key)["Body"].read())
        except Exception as e:  # noqa: BLE001
            if getattr(e, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
        return json.loads(body)

    def put_json(self, bucket: str, key: str, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        _retry(lambda: self.s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json", CacheControl="no-cache"))


class LocalStorage:
    """`root/<bucket>/<key>` — testlar va oflayn ishlab chiqish uchun."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.uploads: list[tuple[str, str, str]] = []

    def _path(self, bucket: str, key: str) -> Path:
        return self.root / bucket / key

    def download(self, bucket: str, key: str, dst: Path) -> int:
        src = self._path(bucket, key)
        if not src.exists():
            raise FileNotFoundError(f"{bucket}/{key}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        return dst.stat().st_size

    def upload_file(self, src: Path, bucket: str, key: str) -> None:
        dst = self._path(bucket, key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        self.uploads.append((bucket, key, content_type(src)))

    def get_json(self, bucket: str, key: str) -> dict | None:
        p = self._path(bucket, key)
        return json.loads(p.read_text()) if p.exists() else None

    def put_json(self, bucket: str, key: str, data: dict) -> None:
        p = self._path(bucket, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data))
