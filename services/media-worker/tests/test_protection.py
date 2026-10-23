"""ECS task scale-in protection: agent endpoint chaqiruvlari va worker bilan ulanishi."""

from __future__ import annotations

import json
import time

import httpx

from media_worker.errors import JobError, RetryableError
from media_worker.protection import EcsTaskProtection
from media_worker.worker import Worker

from .fakes import FakeApi, ListSource
from .test_worker import JOB, StubPipeline, d


class Agent:
    """ECS agent endpoint dublyori: so'rovlarni yozadi, kerak bo'lsa rad etadi."""

    def __init__(self) -> None:
        self.bodies: list[dict] = []
        self.reject = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.url.path == "/v3/abc/task-protection/v1/state"
        self.bodies.append(json.loads(request.content))
        if self.reject:
            return httpx.Response(200, json={"failure": {"Reason": "TASK_NOT_VALID"}})
        return httpx.Response(200, json={"protection": {"ProtectionEnabled": True}})


def protection(agent: Agent, clock=None, **kw) -> EcsTaskProtection:
    client = httpx.Client(transport=httpx.MockTransport(agent.handler))
    return EcsTaskProtection("http://169.254.170.2/v3/abc/", client=client, clock=clock or time.monotonic, **kw)


def test_enable_renew_disable() -> None:
    agent, now = Agent(), [0.0]
    p = protection(agent, clock=lambda: now[0], expires_minutes=60, renew_after_s=900)
    p.enable()
    p.keepalive()  # hali erta
    now[0] = 899
    p.keepalive()
    now[0] = 900
    p.keepalive()  # yangilanadi
    p.disable()
    p.disable()  # takroriy — chaqiruvsiz
    assert agent.bodies == [
        {"ProtectionEnabled": True, "ExpiresInMinutes": 60},
        {"ProtectionEnabled": True, "ExpiresInMinutes": 60},
        {"ProtectionEnabled": False},
    ]


def test_rejected_enable_is_retried_on_next_keepalive_and_never_raises() -> None:
    agent, now = Agent(), [0.0]
    p = protection(agent, clock=lambda: now[0], renew_after_s=900)
    agent.reject = True
    p.enable()  # rad etildi — xato ko'tarilmaydi
    agent.reject = False
    now[0] = 1
    p.keepalive()  # darhol qayta urinadi
    assert [b["ProtectionEnabled"] for b in agent.bodies] == [True, True]


def test_network_error_does_not_break_job() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("agent yo'q")

    p = EcsTaskProtection("http://169.254.170.2/v3/abc", client=httpx.Client(transport=httpx.MockTransport(boom)))
    p.enable()
    p.keepalive()
    p.disable()


class Recorder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def enable(self) -> None:
        self.calls.append("enable")

    def keepalive(self) -> None:
        self.calls.append("keepalive")

    def disable(self) -> None:
        self.calls.append("disable")


class SlowPipeline(StubPipeline):
    def run(self, job: dict, progress) -> dict:
        time.sleep(0.25)
        return super().run(job, progress)


def test_worker_protects_only_while_processing() -> None:
    rec = Recorder()
    src, api = ListSource([d()]), FakeApi(JOB)
    Worker(src, api, SlowPipeline({"hls_master_key": "k"}), keepalive_s=0.05, protection=rec).handle(src.deliveries.pop())
    # start'dan keyin yoqiladi, uzoq bosqichda yangilanadi, natija yuborilgach o'chiriladi
    assert rec.calls[0] == "enable" and rec.calls[-1] == "disable"
    assert "keepalive" in rec.calls
    assert api.results()[0][0] == "ready"


def test_protection_released_on_failure_and_retry_and_not_taken_for_gone_jobs() -> None:
    for outcome in (JobError("NOT_A_VIDEO", "x"), RetryableError("S3 503")):
        rec = Recorder()
        src = ListSource([d()])
        Worker(src, FakeApi(JOB), StubPipeline(outcome), protection=rec).handle(src.deliveries.pop())
        assert rec.calls == ["enable", "disable"]

    rec = Recorder()
    src, api = ListSource([d()]), FakeApi(JOB)
    api.gone = True
    assert Worker(src, api, StubPipeline(), protection=rec).handle(src.deliveries.pop()) == "skipped"
    assert rec.calls == []
