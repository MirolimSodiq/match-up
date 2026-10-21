"""Job manbai. Hozir — Redis Stream consumer group (dev va prod bir xil). AI-Cam GPU job'lari uchun keyinchalik
`SqsSource` (receive -> visibility timeout, extend -> ChangeMessageVisibility, ack -> DeleteMessage) xuddi shu
`JobSource` interfeysini amalga oshiradi; `Worker` transportni bilmaydi.

Redis Stream semantikasi (at-least-once):
  * yangi xabarlar: XREADGROUP ... STREAMS <stream> >
  * ishlov paytida lease uzaytiriladi: XCLAIM ... 0 <id> JUSTID (idle vaqt nolga tushadi)
  * worker o'lsa: xabar `claim_idle_ms` dan keyin boshqa consumer'ga o'tadi (XPENDING IDLE + XCLAIM)
  * `max_deliveries` dan oshsa: dead-letter stream'ga (XADD) va ACK.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol

import redis

log = logging.getLogger("media_worker.queue")


@dataclass
class Delivery:
    id: str
    fields: dict[str, str]
    deliveries: int = 1
    #: transportga xos (SQS receipt handle va h.k.)
    meta: dict = field(default_factory=dict)

    @property
    def job_id(self) -> str:
        return self.fields.get("job_id", "")

    @property
    def type(self) -> str:
        return self.fields.get("type", "")


class JobSource(Protocol):
    def receive(self) -> Iterator[Delivery]: ...
    def extend(self, d: Delivery) -> None: ...
    def ack(self, d: Delivery) -> None: ...
    def dead_letter(self, d: Delivery, reason: str) -> None: ...


def _s(v: bytes | str) -> str:
    return v.decode() if isinstance(v, bytes) else v


class RedisStreamSource:
    def __init__(
        self,
        client: redis.Redis,
        stream: str,
        group: str,
        consumer: str,
        dead_stream: str,
        claim_idle_ms: int = 120_000,
        block_ms: int = 5_000,
    ) -> None:
        self.r = client
        self.stream = stream
        self.group = group
        self.consumer = consumer
        self.dead_stream = dead_stream
        self.claim_idle_ms = claim_idle_ms
        self.block_ms = block_ms

    def ensure_group(self) -> None:
        """Guruh stream boshidan ('0') yaratiladi: worker birinchi marta ishga tushganda navbatdagi job'lar yo'qolmaydi."""
        try:
            self.r.xgroup_create(self.stream, self.group, id="0", mkstream=True)
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    def _reclaim(self) -> Iterator[Delivery]:
        pending = self.r.xpending_range(self.stream, self.group, min="-", max="+", count=10, idle=self.claim_idle_ms)
        for p in pending:
            mid = _s(p["message_id"])
            claimed = self.r.xclaim(self.stream, self.group, self.consumer, self.claim_idle_ms, [mid])
            if not claimed:
                continue  # boshqa consumer oldinroq oldi
            entry_id, fields = claimed[0]
            if fields is None:  # stream'dan o'chirilgan (MAXLEN) — ACK
                self.r.xack(self.stream, self.group, mid)
                continue
            yield Delivery(_s(entry_id), {_s(k): _s(v) for k, v in fields.items()}, int(p["times_delivered"]) + 1)

    def receive(self) -> Iterator[Delivery]:
        yield from self._reclaim()
        res = self.r.xreadgroup(self.group, self.consumer, {self.stream: ">"}, count=1, block=self.block_ms)
        for _stream, entries in res or []:
            for entry_id, fields in entries:
                yield Delivery(_s(entry_id), {_s(k): _s(v) for k, v in fields.items()}, 1)

    def extend(self, d: Delivery) -> None:
        self.r.xclaim(self.stream, self.group, self.consumer, 0, [d.id], justid=True)

    def ack(self, d: Delivery) -> None:
        self.r.xack(self.stream, self.group, d.id)

    def dead_letter(self, d: Delivery, reason: str) -> None:
        self.r.xadd(
            self.dead_stream,
            {**d.fields, "source_id": d.id, "deliveries": str(d.deliveries), "reason": reason[:1000]},
            maxlen=10_000,
            approximate=True,
        )
        self.ack(d)
