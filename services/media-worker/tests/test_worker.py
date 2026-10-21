from __future__ import annotations

import time
from pathlib import Path

import fakeredis
import pytest

from media_worker.errors import JobError, RetryableError
from media_worker.queue import Delivery, RedisStreamSource
from media_worker.worker import Worker

from .fakes import FakeApi, ListSource

JOB = {"type": "transcode", "profile": "highlight_v1"}


class StubPipeline:
    def __init__(self, *results: object) -> None:
        self.results = list(results)
        self.cleaned: list[str] = []

    def run(self, job: dict, progress) -> dict:
        progress("probe")
        r = self.results.pop(0)
        if isinstance(r, Exception):
            raise r
        return r  # type: ignore[return-value]

    def cleanup(self, job_id: str) -> None:
        self.cleaned.append(job_id)


def d(n: int = 1, job_id: str = "j1", type_: str = "transcode") -> Delivery:
    return Delivery(f"1-{n}", {"v": "1", "job_id": job_id, "type": type_, "media_id": "m1"}, n)


def test_success_acks_and_reports() -> None:
    api, src, pipe = FakeApi(JOB), ListSource([d()]), StubPipeline({"hls_master_key": "k"})
    w = Worker(src, api, pipe)
    assert w.run_once() == 1
    assert src.acked == ["1-1"] and api.results() == [("ready", {"hls_master_key": "k"})]
    assert api.stages() == ["probe"] and src.extended == 1  # progress -> heartbeat + lease
    assert pipe.cleaned == ["j1"]


def test_validation_error_is_final() -> None:
    api, src = FakeApi(JOB), ListSource([d()])
    assert Worker(src, api, StubPipeline(JobError("DURATION_TOO_LONG", "61 s"))).handle(src.deliveries.pop()) == "failed"
    assert api.results() == [("failed", "DURATION_TOO_LONG")] and src.acked == ["1-1"]


def test_transient_error_leaves_message_pending() -> None:
    api, src = FakeApi(JOB), ListSource([])
    w = Worker(src, api, StubPipeline(RetryableError("S3 503")))
    assert w.handle(d()) == "retry"
    assert src.acked == [] and api.results() == []


def test_ready_report_failure_is_retried() -> None:
    api, src = FakeApi(JOB), ListSource([])
    api.fail_ready = 1
    assert Worker(src, api, StubPipeline({"x": 1})).handle(d()) == "retry"
    assert src.acked == []


def test_gone_job_is_acked_without_processing() -> None:
    api, src = FakeApi(JOB), ListSource([])
    api.gone = True
    pipe = StubPipeline()
    assert Worker(src, api, pipe).handle(d()) == "skipped"
    assert src.acked == ["1-1"] and api.results() == []


def test_dead_letter_after_max_deliveries() -> None:
    api, src = FakeApi(JOB), ListSource([])
    assert Worker(src, api, StubPipeline(), max_deliveries=5).handle(d(6)) == "dead"
    assert api.results() == [("failed", "MAX_RETRIES_EXCEEDED")]
    assert src.dead == [("1-6", "max deliveries exceeded")]


def test_unknown_type_dead_lettered() -> None:
    api, src = FakeApi(JOB), ListSource([])
    assert Worker(src, api, StubPipeline()).handle(d(type_="ai_detect_events")) == "dead"
    assert api.calls == []


# --- Redis Stream (fakeredis) ----------------------------------------------------------------
@pytest.fixture
def r() -> fakeredis.FakeRedis:
    return fakeredis.FakeRedis()


def source(r, consumer: str, idle_ms: int = 50) -> RedisStreamSource:
    s = RedisStreamSource(r, "matchup:media-jobs", "media-worker", consumer, "matchup:media-jobs:dead", claim_idle_ms=idle_ms, block_ms=10)
    s.ensure_group()
    return s


def publish(r, job_id: str) -> None:
    r.xadd("matchup:media-jobs", {"v": "1", "job_id": job_id, "type": "transcode", "media_id": "m1", "enqueued_at": "now"})


def test_group_reads_backlog_published_before_worker_started(r) -> None:
    publish(r, "early")
    got = list(source(r, "a").receive())
    assert [x.job_id for x in got] == ["early"] and got[0].deliveries == 1


def test_crashed_consumer_message_is_reclaimed_with_delivery_count(r, tmp_path: Path) -> None:
    publish(r, "j1")
    a, b = source(r, "a"), source(r, "b")
    first = list(a.receive())
    assert len(first) == 1  # "a" oldi va ACK qilmasdan o'ldi
    assert list(b.receive()) == []  # hali idle emas
    time.sleep(0.08)
    again = list(b.receive())
    assert [(x.job_id, x.deliveries) for x in again] == [("j1", 2)]
    b.ack(again[0])
    time.sleep(0.08)
    assert list(a.receive()) == []
    assert r.xpending("matchup:media-jobs", "media-worker")["pending"] == 0


def test_extend_resets_idle_so_long_jobs_are_not_stolen(r) -> None:
    publish(r, "j1")
    a, b = source(r, "a", idle_ms=60), source(r, "b", idle_ms=60)
    msg = next(iter(a.receive()))
    for _ in range(3):
        time.sleep(0.03)
        a.extend(msg)  # progress paytida
    assert list(b.receive()) == []


def test_dead_letter_stream(r) -> None:
    publish(r, "j1")
    s = source(r, "a")
    msg = next(iter(s.receive()))
    s.dead_letter(msg, "max deliveries exceeded")
    dead = r.xrange("matchup:media-jobs:dead")
    assert len(dead) == 1 and dead[0][1][b"job_id"] == b"j1" and dead[0][1][b"reason"] == b"max deliveries exceeded"
    assert r.xpending("matchup:media-jobs", "media-worker")["pending"] == 0


def test_worker_end_to_end_with_stream(r) -> None:
    publish(r, "j1")
    s = source(r, "a")
    api = FakeApi(JOB)
    w = Worker(s, api, StubPipeline(RetryableError("S3 503"), {"hls_master_key": "k"}))
    w.run_once()  # 1-urinish: xato, pending
    assert r.xpending("matchup:media-jobs", "media-worker")["pending"] == 1
    time.sleep(0.08)
    w.run_once()  # reclaim -> 2-urinish: muvaffaqiyat
    assert api.results() == [("ready", {"hls_master_key": "k"})]
    assert r.xpending("matchup:media-jobs", "media-worker")["pending"] == 0


def test_keepalive_extends_lease_during_long_stage() -> None:
    class SlowPipeline(StubPipeline):
        def run(self, job: dict, progress) -> dict:
            progress("hls")
            time.sleep(0.35)  # bitta uzoq bosqich (progress chaqirilmaydi)
            return {"hls_master_key": "k"}

    api, src = FakeApi(JOB), ListSource([])
    w = Worker(src, api, SlowPipeline(), keepalive_s=0.05)
    assert w.handle(d()) == "ok"
    # progress'dan 1 marta + keepalive'dan bir necha marta
    assert src.extended >= 4
    assert api.stages().count("hls") >= 4
    n = src.extended
    time.sleep(0.15)
    assert src.extended == n  # job tugagach keepalive to'xtaydi
