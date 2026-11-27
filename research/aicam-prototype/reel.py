"""Bitta o'yinchi videosi (player reel, AI_CAM.md §4): o'yinchini kuzatuvchi kvadrat kadr, belgi, raqam va jamoa.
Reyting va harakat yorliqlari yo'q — ular hali hisoblanmaydi.

    python reel.py out/reel20.avi "ko'k #20" 30 "<chap>" 631 out/L631 L "<o'ng>" 420 out/R420 R
"""

import json
import sys

import cv2
import numpy as np

from post import analyse

OUT = 720
FPS = 30
MIN_SEGMENT = 45  # 1.5 s dan qisqa bo'lak reel'ga kirmaydi
MAX_GAP = 10  # shu kadrgacha yo'qolsa — oxirgi joyida ushlab turiladi
TEAM_BGR = {'yashil': (60, 230, 120), "ko'k": (230, 120, 40)}


def player_boxes(prefix: str, cam: str, polygon: list, person: str) -> dict[int, np.ndarray]:
    tids = set(analyse(prefix, cam, polygon)['odamlar'].get(person, {}).get('treklar', []))
    rows = np.load(prefix + '.tracks.npy')
    return {int(r[0]): r[2:] for r in rows if int(r[1]) in tids}


def plan(cams: list[dict], n: int, max_seconds: float) -> list[tuple[int, int, np.ndarray]]:
    """Har kadr uchun (kadr, kamera, ramka). Joriy kamerada qolinadi; yo'qolsa — boshqasiga o'tiladi."""
    shots, cur, last, lost = [], None, None, 0
    for i in range(n):
        seen = [k for k, c in enumerate(cams) if i in c['boxes']]
        if cur not in seen and seen:
            cur = max(seen, key=lambda k: cams[k]['boxes'][i][3] - cams[k]['boxes'][i][1])  # yaqinroq kamera
        if cur in seen:
            last, lost = cams[cur]['boxes'][i], 0
        elif last is not None and lost < MAX_GAP:
            lost += 1
        else:
            last = None
        if last is not None:
            shots.append((i, cur, last))
    segments, seg = [], []
    for s in shots:
        if seg and (s[0] != seg[-1][0] + 1 or s[1] != seg[-1][1]):
            segments.append(seg)
            seg = []
        seg.append(s)
    segments.append(seg)
    keep, total = [], 0
    for seg in segments:
        if len(seg) >= MIN_SEGMENT and total < max_seconds * FPS:
            keep += seg[: int(max_seconds * FPS) - total]
            total += len(seg)
    return keep


def crop_window(box: np.ndarray, frame_shape, prev):
    h = box[3] - box[1]
    side = float(np.clip(3.2 * h, 720, 1600))
    cx, cy = (box[0] + box[2]) / 2, box[1] + 0.45 * h
    if prev is not None:  # silliq harakat: keskin sakramasin
        cx, cy, side = (0.85 * np.array(prev) + 0.15 * np.array([cx, cy, side])).tolist()
    H, W = frame_shape[:2]
    cx = min(max(cx, side / 2), W - side / 2)
    cy = min(max(cy, side / 2), H - side / 2)
    return cx, cy, side


def overlay(img: np.ndarray, number: str, team: str, cam: str) -> None:
    color = TEAM_BGR.get(team, (200, 200, 200))
    cv2.rectangle(img, (16, 16), (76, 76), color, -1)
    cv2.putText(img, number, (24 if len(number) == 2 else 36, 58), cv2.FONT_HERSHEY_DUPLEX, 1.1, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.rectangle(img, (76, 16), (300, 76), (40, 24, 18), -1)
    cv2.putText(img, f"{team.upper()} #{number}", (90, 56), cv2.FONT_HERSHEY_DUPLEX, 0.85, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.rectangle(img, (OUT - 250, 16), (OUT - 16, 56), (40, 24, 18), -1)
    cv2.putText(img, 'MATCH UP  AI-CAM', (OUT - 238, 44), cv2.FONT_HERSHEY_DUPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(img, f'prototip  |  kamera {cam}', (16, OUT - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (235, 235, 235), 1, cv2.LINE_AA)


def marker(img: np.ndarray, x: int, y: int, label: str) -> None:
    pts = np.array([[x - 14, y - 26], [x + 14, y - 26], [x, y - 6]], np.int32)
    cv2.fillPoly(img, [pts], (40, 24, 18))
    cv2.polylines(img, [pts], True, (255, 255, 255), 1, cv2.LINE_AA)
    (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_DUPLEX, 0.6, 1)
    cv2.putText(img, label, (x - tw // 2, y - 34), cv2.FONT_HERSHEY_DUPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)


def main(out: str, person: str, max_seconds: str, *args: str) -> None:
    calib = json.load(open('calib.json'))
    team, number = person.split(' #')
    cams = []
    for i in range(0, len(args), 4):
        src, start, prefix, cam = args[i : i + 4]
        cap = cv2.VideoCapture(src)
        cap.set(cv2.CAP_PROP_POS_MSEC, float(start) * 1000)
        cams.append({'cap': cap, 'name': cam, 'boxes': player_boxes(prefix, cam, calib[cam], person)})
    n = min(max(c['boxes']) for c in cams if c['boxes']) + 1
    shots = dict((i, (k, box)) for i, k, box in plan(cams, n, float(max_seconds)))
    writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'MJPG'), FPS, (OUT, OUT))
    prev, prev_cam = None, None
    for i in range(max(shots) + 1):
        frames = [c['cap'].read()[1] for c in cams]  # kameralar sinxron qolishi uchun hammasi o'qiladi
        if i not in shots:
            prev = None
            continue
        k, box = shots[i]
        frame = frames[k]
        if k != prev_cam or (i - 1) not in shots:
            prev = None
        prev = crop_window(box, frame.shape, prev)
        prev_cam = k
        cx, cy, side = prev
        x0, y0 = int(cx - side / 2), int(cy - side / 2)
        crop = cv2.resize(frame[y0 : y0 + int(side), x0 : x0 + int(side)], (OUT, OUT), interpolation=cv2.INTER_AREA)
        s = OUT / side
        marker(crop, int(((box[0] + box[2]) / 2 - x0) * s), int((box[1] - y0) * s), f'#{number}')
        overlay(crop, number, team, cams[k]['name'])
        writer.write(crop)
    writer.release()
    print(f'reel: {len(shots) / FPS:.1f} s')


if __name__ == '__main__':
    main(*sys.argv[1:])
