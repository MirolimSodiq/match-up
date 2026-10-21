"""Worker -> API ichki endpointlari (`/internal/media/jobs/{id}/...`, servis token). Worker DB'ga yozmaydi."""

from __future__ import annotations

import time
from typing import Any, Protocol

import httpx

from .errors import JobGone, RetryableError


class Api(Protocol):
    def start(self, job_id: str, worker_version: str) -> dict: ...
    def progress(self, job_id: str, stage: str) -> None: ...
    def ready(self, job_id: str, worker_version: str, output: dict) -> dict: ...
    def failed(self, job_id: str, worker_version: str, code: str, message: str) -> dict: ...


class HttpApi:
    def __init__(self, base_url: str, token: str, timeout: float = 15.0, attempts: int = 4) -> None:
        if len(token) < 32:
            raise ValueError("MEDIA_WORKER_TOKEN kamida 32 belgi bo'lishi kerak")
        self.client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Authorization": f"Bearer {token}", "User-Agent": "matchup-media-worker"},
        )
        self.attempts = attempts

    def _post(self, path: str, body: dict[str, Any]) -> dict:
        last: Exception | None = None
        for i in range(self.attempts):
            try:
                r = self.client.post(path, json=body)
            except httpx.TransportError as e:
                last = e
            else:
                if r.status_code in (404, 409):
                    raise JobGone(f"{path}: {r.status_code} {r.text[:200]}")
                if r.status_code < 500 and r.status_code != 429:
                    if r.status_code >= 400:
                        # 401/422 — konfiguratsiya yoki kontrakt xatosi: keyinroq (yangi deploy) qayta urinish
                        raise RetryableError(f"{path}: {r.status_code} {r.text[:300]}")
                    return r.json()
                last = RetryableError(f"{path}: {r.status_code}")
            time.sleep(min(8.0, 0.5 * 2**i))
        raise RetryableError(f"API javob bermadi: {path}: {last}")

    def start(self, job_id: str, worker_version: str) -> dict:
        return self._post(f"/internal/media/jobs/{job_id}/start", {"worker_version": worker_version})

    def progress(self, job_id: str, stage: str) -> None:
        self._post(f"/internal/media/jobs/{job_id}/progress", {"stage": stage})

    def ready(self, job_id: str, worker_version: str, output: dict) -> dict:
        return self._post(f"/internal/media/jobs/{job_id}/result", {"status": "ready", "worker_version": worker_version, "output": output})

    def failed(self, job_id: str, worker_version: str, code: str, message: str) -> dict:
        return self._post(
            f"/internal/media/jobs/{job_id}/result",
            {"status": "failed", "worker_version": worker_version, "error_code": code, "error_message": message[:2000]},
        )
