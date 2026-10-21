"""Navbat -> API -> pipeline -> natija. Transport (`JobSource`) va storage'dan mustaqil."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from . import WORKER_VERSION
from .api import Api
from .errors import JobError, JobGone
from .pipeline import Pipeline
from .queue import Delivery, JobSource

log = logging.getLogger("media_worker")

#: Hozircha faqat CPU transcode. AI-Cam job turlari (ai_*) alohida GPU worker'da (SQS + AWS Batch).
SUPPORTED_TYPES = {"transcode"}


class Worker:
    def __init__(
        self,
        source: JobSource,
        api: Api,
        pipeline: Pipeline,
        max_deliveries: int = 5,
        heartbeat_file: Path | None = None,
        keepalive_s: float = 30.0,
    ) -> None:
        self.source = source
        self.api = api
        self.pipeline = pipeline
        self.max_deliveries = max_deliveries
        self.heartbeat_file = heartbeat_file
        #: CLAIM_IDLE_MS (120 s) va API "boshqa worker ishlayapti" chegarasidan (2 daq) ancha kichik
        self.keepalive_s = keepalive_s
        self.stop = threading.Event()

    def beat(self) -> None:
        if self.heartbeat_file:
            self.heartbeat_file.parent.mkdir(parents=True, exist_ok=True)
            self.heartbeat_file.write_text(str(time.time()))

    def run_once(self) -> int:
        n = 0
        for d in self.source.receive():
            self.handle(d)
            n += 1
            if self.stop.is_set():
                break
        self.beat()
        return n

    def run_forever(self) -> None:
        log.info("worker %s ishga tushdi", WORKER_VERSION)
        while not self.stop.is_set():
            try:
                self.run_once()
            except Exception:  # noqa: BLE001 — Redis uzilishi va h.k.: jarayon yiqilmaydi
                log.exception("navbatdan o'qishda xato")
                self.stop.wait(2)
        log.info("worker to'xtadi")

    def handle(self, d: Delivery) -> str:
        """Natija: `ok` | `failed` | `skipped` | `retry` | `dead` (testlar va log uchun)."""
        job_id = d.job_id
        if not job_id or d.type not in SUPPORTED_TYPES:
            log.warning("xabar %s: noma'lum job (%s) — dead-letter", d.id, d.type)
            self.source.dead_letter(d, f"unsupported type: {d.type!r}")
            return "dead"

        if d.deliveries > self.max_deliveries:
            log.error("job %s: %d marta yetkazildi — dead-letter", job_id, d.deliveries)
            try:
                self.api.failed(job_id, WORKER_VERSION, "MAX_RETRIES_EXCEEDED", f"{d.deliveries - 1} urinishdan keyin")
            except JobGone:
                pass
            except Exception:  # noqa: BLE001 — API ishlamasa: xabar keyingi safar yana dead-letter yo'liga tushadi
                log.exception("job %s: failed natijasi yuborilmadi", job_id)
                return "retry"
            self.source.dead_letter(d, "max deliveries exceeded")
            return "dead"

        try:
            job = self.api.start(job_id, WORKER_VERSION)
        except JobGone as e:
            log.info("job %s: o'tkazib yuborildi (%s)", job_id, e)
            self.source.ack(d)
            return "skipped"
        except Exception:  # noqa: BLE001
            log.exception("job %s: start xatosi (%d-urinish)", job_id, d.deliveries)
            return "retry"

        state = {"stage": "probe"}

        def progress(stage: str) -> None:
            state["stage"] = stage
            self.api.progress(job_id, stage)
            self.source.extend(d)
            self.beat()

        # Uzoq bosqichda (HLS encode) ham lease va API heartbeat yangilanib tursin — aks holda xabar
        # boshqa consumer'ga o'tib, job ikki marta kodlanadi
        done = threading.Event()

        def keepalive() -> None:
            while not done.wait(self.keepalive_s):
                try:
                    self.source.extend(d)
                    self.api.progress(job_id, state["stage"])
                    self.beat()
                except Exception:  # noqa: BLE001 — keyingi siklda qayta urinadi
                    log.debug("job %s: keepalive xatosi", job_id, exc_info=True)

        ka = threading.Thread(target=keepalive, name=f"keepalive-{job_id}", daemon=True)
        ka.start()
        try:
            t0 = time.monotonic()
            output = self.pipeline.run(job, progress)
            done.set()
            self.api.ready(job_id, WORKER_VERSION, output)
            log.info("job %s: tayyor (%.1fs)", job_id, time.monotonic() - t0)
        except JobGone as e:
            log.info("job %s: API job'ni yopdi (%s)", job_id, e)
            self.source.ack(d)
            self.pipeline.cleanup(job_id)
            return "skipped"
        except JobError as e:
            log.warning("job %s: %s", job_id, e)
            try:
                self.api.failed(job_id, WORKER_VERSION, e.code, e.message)
            except JobGone:
                pass
            except Exception:  # noqa: BLE001
                log.exception("job %s: failed natijasi yuborilmadi — qayta urinadi", job_id)
                return "retry"
            self.source.ack(d)
            self.pipeline.cleanup(job_id)
            return "failed"
        except Exception:  # noqa: BLE001 — RetryableError va kutilmagan xatolar
            log.exception("job %s: vaqtinchalik xato (%d/%d) — xabar ACK qilinmadi", job_id, d.deliveries, self.max_deliveries)
            return "retry"
        finally:
            done.set()
        self.source.ack(d)
        self.pipeline.cleanup(job_id)
        return "ok"
