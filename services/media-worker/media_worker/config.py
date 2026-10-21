"""Env orqali konfiguratsiya (API'ning `.env` nomlari bilan bir xil: S3_*, MEDIA_*, REDIS_URL)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    v = os.environ.get(name)
    return int(v) if v else default


@dataclass(frozen=True)
class Settings:
    redis_url: str = "redis://localhost:6379/4"
    jobs_stream: str = "matchup:media-jobs"
    jobs_group: str = "media-worker"
    dead_stream: str = "matchup:media-jobs:dead"
    consumer: str = field(default_factory=lambda: f"{os.uname().nodename}-{os.getpid()}")

    api_url: str = "http://localhost:3002"
    worker_token: str = ""

    s3_endpoint: str | None = None
    s3_region: str = "eu-central-1"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_force_path_style: bool = False

    work_dir: str = "/tmp/media-worker"
    #: Shuncha yetkazishdan keyin xabar dead-letter stream'ga o'tadi va job `failed` bo'ladi
    max_deliveries: int = 5
    #: ACK qilinmagan xabar shuncha vaqt jim tursa boshqa consumer uni oladi (worker ishlayotganda lease uzaytiriladi)
    claim_idle_ms: int = 120_000
    block_ms: int = 5_000
    ffmpeg_preset: str = "veryfast"
    ffmpeg_threads: int = 0

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ
        return cls(
            redis_url=e.get("REDIS_URL", cls.redis_url),
            jobs_stream=e.get("MEDIA_JOBS_STREAM", cls.jobs_stream),
            jobs_group=e.get("MEDIA_JOBS_GROUP", cls.jobs_group),
            dead_stream=e.get("MEDIA_JOBS_DEAD_STREAM", e.get("MEDIA_JOBS_STREAM", cls.jobs_stream) + ":dead"),
            consumer=e.get("MEDIA_WORKER_CONSUMER") or f"{os.uname().nodename}-{os.getpid()}",
            api_url=e.get("API_INTERNAL_URL", cls.api_url).rstrip("/"),
            worker_token=e.get("MEDIA_WORKER_TOKEN", ""),
            s3_endpoint=e.get("S3_ENDPOINT") or None,
            s3_region=e.get("S3_REGION", cls.s3_region),
            s3_access_key_id=e.get("S3_ACCESS_KEY_ID") or None,
            s3_secret_access_key=e.get("S3_SECRET_ACCESS_KEY") or None,
            s3_force_path_style=_bool(e.get("S3_FORCE_PATH_STYLE")),
            work_dir=e.get("WORK_DIR", cls.work_dir),
            max_deliveries=_int("MAX_DELIVERIES", cls.max_deliveries),
            claim_idle_ms=_int("CLAIM_IDLE_MS", cls.claim_idle_ms),
            block_ms=_int("BLOCK_MS", cls.block_ms),
            ffmpeg_preset=e.get("FFMPEG_PRESET", cls.ffmpeg_preset),
            ffmpeg_threads=_int("FFMPEG_THREADS", cls.ffmpeg_threads),
        )
