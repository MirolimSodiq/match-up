"""`python -m media_worker` — navbatdan job'larni o'qiydi; `python -m media_worker health` — ECS healthcheck."""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from pathlib import Path

import redis

from .api import HttpApi
from .config import Settings
from .pipeline import Pipeline
from .queue import RedisStreamSource
from .storage import S3Storage
from .worker import Worker

HEALTH_MAX_AGE_S = 120


def health(settings: Settings) -> int:
    """Heartbeat fayli yangi bo'lsa 0 (navbat sikli tirik)."""
    f = Path(settings.work_dir) / "heartbeat"
    try:
        age = time.time() - float(f.read_text())
    except (OSError, ValueError):
        return 1
    return 0 if age < HEALTH_MAX_AGE_S else 1


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    settings = Settings.from_env()
    if sys.argv[1:2] == ["health"]:
        return health(settings)

    source = RedisStreamSource(
        redis.Redis.from_url(settings.redis_url, socket_timeout=settings.block_ms / 1000 + 10, health_check_interval=30),
        settings.jobs_stream,
        settings.jobs_group,
        settings.consumer,
        settings.dead_stream,
        settings.claim_idle_ms,
        settings.block_ms,
    )
    source.ensure_group()
    storage = S3Storage(settings.s3_endpoint, settings.s3_region, settings.s3_access_key_id, settings.s3_secret_access_key, settings.s3_force_path_style)
    worker = Worker(
        source,
        HttpApi(settings.api_url, settings.worker_token),
        Pipeline(storage, Path(settings.work_dir) / "jobs", settings.ffmpeg_preset, settings.ffmpeg_threads),
        settings.max_deliveries,
        Path(settings.work_dir) / "heartbeat",
    )

    def shutdown(signum: int, _frame: object) -> None:
        logging.getLogger("media_worker").info("signal %d: joriy job tugagach to'xtaydi", signum)
        worker.stop.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    worker.run_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
