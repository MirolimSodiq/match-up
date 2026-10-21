"""Xato turlari: qayta urinish ma'nosiz (validatsiya) va qayta urinsa bo'ladigan (tarmoq, storage) xatolar."""

from __future__ import annotations


class JobError(Exception):
    """Qayta urinish natijani o'zgartirmaydi: job darhol `failed`, xabar ACK qilinadi."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


class JobGone(Exception):
    """API job'ni bermadi (tugagan, bekor qilingan yoki boshqa worker ishlayapti) — xabar ACK qilinadi."""


class RetryableError(Exception):
    """Vaqtinchalik xato (tarmoq, 5xx, storage). Xabar ACK qilinmaydi — keyin qayta yetkaziladi."""
