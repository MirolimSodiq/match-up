"""API va manba uchun test dublyorlari."""

from __future__ import annotations

from collections.abc import Iterator

from media_worker.errors import JobGone, RetryableError
from media_worker.queue import Delivery


class FakeApi:
    def __init__(self, job: dict | None = None) -> None:
        self.job = job
        self.calls: list[tuple] = []
        self.gone = False
        self.fail_ready = 0

    def start(self, job_id: str, worker_version: str) -> dict:
        self.calls.append(("start", job_id))
        if self.gone or self.job is None:
            raise JobGone("409 INVALID_STATE")
        return {**self.job, "job_id": job_id}

    def progress(self, job_id: str, stage: str) -> None:
        self.calls.append(("progress", stage))

    def ready(self, job_id: str, worker_version: str, output: dict) -> dict:
        if self.fail_ready > 0:
            self.fail_ready -= 1
            raise RetryableError("API javob bermadi")
        self.calls.append(("ready", output))
        return {"status": "succeeded"}

    def failed(self, job_id: str, worker_version: str, code: str, message: str) -> dict:
        self.calls.append(("failed", code))
        return {"status": "failed"}

    def stages(self) -> list[str]:
        return [c[1] for c in self.calls if c[0] == "progress"]

    def results(self) -> list[tuple]:
        return [c for c in self.calls if c[0] in ("ready", "failed")]


class ListSource:
    def __init__(self, deliveries: list[Delivery]) -> None:
        self.deliveries = deliveries
        self.acked: list[str] = []
        self.dead: list[tuple[str, str]] = []
        self.extended = 0

    def receive(self) -> Iterator[Delivery]:
        while self.deliveries:
            yield self.deliveries.pop(0)

    def extend(self, d: Delivery) -> None:
        self.extended += 1

    def ack(self, d: Delivery) -> None:
        self.acked.append(d.id)

    def dead_letter(self, d: Delivery, reason: str) -> None:
        self.dead.append((d.id, reason))
        self.ack(d)
