"""Videoning bir qismi: topish → kuzatish → jamoa → raqam; belgilangan video va treklar JSON'i.

    uv run python run.py <video> <boshlanish_s> <davomiylik_s> out/<nom>
"""

import collections
import json
import sys
import time

import cv2
import easyocr
import numpy as np
from PIL import Image
from rfdetr import RFDETRMedium

from tracker import IoUTracker
from vest import number, team

# RF-DETR COCO sinflari (91 indeks)
PERSON, BALL = 1, 37
COLORS = {'yashil': (60, 230, 120), "ko'k": (230, 120, 40), None: (180, 180, 180)}
OUT_W, OUT_H = 1920, 1080


def main(src: str, start: float, duration: float, out: str) -> None:
    model = RFDETRMedium()
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    tracker = IoUTracker()
    cap = cv2.VideoCapture(src)
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    writer = cv2.VideoWriter(out + '.avi', cv2.VideoWriter_fourcc(*'MJPG'), fps, (OUT_W, OUT_H))
    teams: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    numbers: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    seen: collections.Counter = collections.Counter()
    total, t0 = int(duration * fps), time.time()
    # Har kadr ramkalari — keyingi bosqichlar (birlashtirish, xarita) videoni qayta ishlamasdan shundan foydalanadi
    tracks: list[np.ndarray] = []

    for i in range(total):
        ok, frame = cap.read()
        if not ok:
            break
        det = model.predict(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), threshold=0.35)
        people, balls = det[det.class_id == PERSON], det[det.class_id == BALL]
        ids = tracker.update(people.xyxy)
        tracks += [np.r_[i, tid, box] for box, tid in zip(people.xyxy, ids)]
        for box, tid in zip(people.xyxy, ids):
            seen[tid] += 1
            # Rang har 3-kadrda, raqam har 6-kadrda va faqat yetarlicha katta ramkada (OCR qimmat)
            if i % 3 == 0 and (tm := team(frame, box)):
                teams[tid][tm] += 1
            if i % 6 == 0 and box[3] - box[1] > 150:
                txt, conf = number(reader, frame, box)
                if txt and conf > 0.5:
                    numbers[tid][txt] += conf
        writer.write(draw(frame, people.xyxy, ids, balls.xyxy, teams, numbers))
        if i % 150 == 0:
            print(f'{i}/{total} {time.time() - t0:.0f}s', flush=True)

    writer.release()
    summary = {
        int(t): {'kadr': seen[t], 'jamoa': dict(teams[t]), 'raqam': {k: round(v, 2) for k, v in numbers[t].items()}}
        for t in seen
    }
    np.save(out + '.tracks.npy', np.array(tracks).reshape(-1, 6))  # kadr, trek, x1, y1, x2, y2
    with open(out + '.json', 'w') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print(f'tayyor: {time.time() - t0:.0f}s, {len(summary)} trek')


def draw(frame, boxes, ids, balls, teams, numbers):
    img = cv2.resize(frame, (OUT_W, OUT_H))
    s = OUT_W / frame.shape[1]
    for box, tid in zip(boxes, ids):
        tm = teams[tid].most_common(1)[0][0] if teams[tid] else None
        label = f'#{numbers[tid].most_common(1)[0][0]}' if numbers[tid] else f'id{tid}'
        x1, y1, x2, y2 = (box * s).astype(int)
        cv2.rectangle(img, (x1, y1), (x2, y2), COLORS[tm], 2)
        cv2.putText(img, label, (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, COLORS[tm], 2, cv2.LINE_AA)
    for b in balls:
        cx, cy = ((b[:2] + b[2:]) / 2 * s).astype(int)
        cv2.circle(img, (int(cx), int(cy)), 14, (0, 220, 255), 2)
    return img


if __name__ == '__main__':
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4])
