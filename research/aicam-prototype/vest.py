"""Jiletka: jamoa rangi va raqam. Rang chegaralari OpenCV HSV'da (H 0–180)."""

import cv2
import numpy as np

# Pilotdagi jiletkalar: neon yashil va ko'k (AI_CAM.md §1.1). Yangi rang — shu yerga
TEAM_COLORS = {
    'yashil': ((25, 70, 110), (50, 255, 255)),
    "ko'k": ((95, 90, 50), (130, 255, 255)),
}
# Torsdagi ulushi shundan kam bo'lsa — jiletka yo'q (darvozabon, tomoshabin)
MIN_COLOR_SHARE = 0.2
# Oq raqam: past to'yinganlik, yuqori yorqinlik
WHITE = ((0, 0, 150), (180, 70, 255))


def torso(frame: np.ndarray, box: np.ndarray) -> np.ndarray:
    """Ramkaning ko'krak/orqa qismi: oyoq, bosh va chetdagi fon kirmasin."""
    x1, y1, x2, y2 = box.astype(int)
    h, w = y2 - y1, x2 - x1
    return frame[max(0, y1 + int(0.18 * h)) : y1 + int(0.58 * h), max(0, x1 + int(0.1 * w)) : x2 - int(0.1 * w)]


def team(frame: np.ndarray, box: np.ndarray) -> str | None:
    t = torso(frame, box)
    if t.size == 0:
        return None
    hsv = cv2.cvtColor(t, cv2.COLOR_BGR2HSV)
    n = t.shape[0] * t.shape[1]
    shares = {name: cv2.inRange(hsv, np.array(lo), np.array(hi)).sum() / 255 / n for name, (lo, hi) in TEAM_COLORS.items()}
    name, share = max(shares.items(), key=lambda kv: kv[1])
    return name if share >= MIN_COLOR_SHARE else None


def number(reader, frame: np.ndarray, box: np.ndarray) -> tuple[str | None, float]:
    """1–2 xonali raqam va ishonch. Ikki variant: asl kesim va oq piksellar niqobi (yorqin jiletkada oq raqam)."""
    t = torso(frame, box)
    if t.shape[0] < 60:
        return None, 0.0
    t = cv2.resize(t, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    white = cv2.inRange(cv2.cvtColor(t, cv2.COLOR_BGR2HSV), np.array(WHITE[0]), np.array(WHITE[1]))
    white = cv2.morphologyEx(white, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    best: tuple[str | None, float] = (None, 0.0)
    for img in (t, 255 - white):
        for _, txt, conf in reader.readtext(img, allowlist='0123456789', paragraph=False):
            if 1 <= len(txt) <= 2 and conf > best[1]:
                best = (txt, float(conf))
    return best
