"""ECS task scale-in protection — uzoq job (to'liq o'yin yozuvi: kodlash soatlab) paytida task'ni himoyalaydi.

Himoyalangan task'ni ECS na autoscaling scale-in'da, na deploy'da to'xtatmaydi: job tugagach himoya olib
tashlanadi va task odatdagidek almashtiriladi. Worker osilib qolsa himoya `expires_minutes` dan keyin o'zi tushadi,
shuning uchun u keepalive'da muntazam yangilanadi. Himoya bo'lmasa (lokal, xato) job baribir ishlanadi —
faqat scale-in/deploy uni to'xtatib, boshqa task'da qaytadan boshlatishi mumkin (idempotent, vaqt yo'qoladi).

Endpoint: `PUT $ECS_AGENT_URI/task-protection/v1/state` (Fargate platform 1.4+), task role'da
`ecs:UpdateTaskProtection` kerak.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Protocol

import httpx

log = logging.getLogger("media_worker.protection")


class TaskProtection(Protocol):
    def enable(self) -> None: ...
    def keepalive(self) -> None: ...
    def disable(self) -> None: ...


class NoProtection:
    """Lokal va himoya o'chiq lane (kliplar — bir daqiqalik job, stopTimeout yetadi)."""

    def enable(self) -> None:
        pass

    def keepalive(self) -> None:
        pass

    def disable(self) -> None:
        pass


class EcsTaskProtection:
    def __init__(
        self,
        agent_uri: str,
        expires_minutes: int = 60,
        renew_after_s: float = 15 * 60,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.url = agent_uri.rstrip("/") + "/task-protection/v1/state"
        self.expires_minutes = expires_minutes
        #: Muddatdan ancha oldin yangilanadi: bir-ikki keepalive xatosi himoyani tushirmaydi
        self.renew_after_s = renew_after_s
        self.client = client or httpx.Client(timeout=5)
        self.clock = clock
        self._since: float | None = None

    def _put(self, body: dict) -> bool:
        try:
            res = self.client.put(self.url, json=body)
            data = res.json() if res.content else {}
        except (httpx.HTTPError, ValueError) as e:
            log.warning("task protection: %s", e)
            return False
        if res.status_code >= 400 or "failure" in data or "error" in data:
            log.warning("task protection rad etildi (HTTP %d): %s", res.status_code, data.get("failure") or data.get("error") or data)
            return False
        return True

    def enable(self) -> None:
        if self._put({"ProtectionEnabled": True, "ExpiresInMinutes": self.expires_minutes}):
            self._since = self.clock()
            log.info("task protection yoqildi (%d daq)", self.expires_minutes)
        else:
            # Keyingi keepalive qayta urinadi
            self._since = self.clock() - self.renew_after_s

    def keepalive(self) -> None:
        if self._since is not None and self.clock() - self._since >= self.renew_after_s:
            self.enable()

    def disable(self) -> None:
        if self._since is None:
            return
        self._since = None
        if self._put({"ProtectionEnabled": False}):
            log.info("task protection o'chirildi")
