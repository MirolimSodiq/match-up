"""Oddiy kuzatuvchi: IoU + Hungarian. ByteTrack (`trackers` paketi) o'rnatilguncha vaqtinchalik."""

import numpy as np
from scipy.optimize import linear_sum_assignment


def iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)

    def area(r: np.ndarray) -> np.ndarray:
        return (r[:, 2] - r[:, 0]) * (r[:, 3] - r[:, 1])

    return inter / (area(a)[:, None] + area(b)[None, :] - inter + 1e-9)


class IoUTracker:
    """Yo'qolgan trek `max_lost` kadr saqlanadi; to'silgan o'yinchi qaytsa ko'pincha yangi id oladi."""

    def __init__(self, min_iou: float = 0.2, max_lost: int = 60):
        self.tracks: dict[int, dict] = {}
        self.next_id = 1
        self.min_iou = min_iou
        self.max_lost = max_lost

    def update(self, boxes: np.ndarray) -> np.ndarray:
        ids = list(self.tracks)
        out = np.full(len(boxes), -1)
        if ids and len(boxes):
            m = iou(np.array([self.tracks[i]['box'] for i in ids]), boxes)
            for i, j in zip(*linear_sum_assignment(-m)):
                if m[i, j] >= self.min_iou:
                    out[j] = ids[i]
                    self.tracks[ids[i]].update(box=boxes[j], lost=0)
        for j in np.where(out == -1)[0]:
            out[j] = self.next_id
            self.tracks[self.next_id] = {'box': boxes[j], 'lost': 0}
            self.next_id += 1
        for t in ids:
            if t not in out:
                self.tracks[t]['lost'] += 1
                if self.tracks[t]['lost'] > self.max_lost:
                    del self.tracks[t]
        return out
