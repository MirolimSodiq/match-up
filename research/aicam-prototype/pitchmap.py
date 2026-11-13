"""Ikki kamera → bitta maydon xaritasi (yuqoridan, metrda). Masofa faqat konsolga — kalibrovka aniqlashguncha videoda ko'rsatilmaydi.

    python pitchmap.py out/map.avi "<chap>" 631 out/L631 L "<o'ng>" 632.55 out/R632 R
"""

import json
import sys

import cv2
import numpy as np

from post import analyse

FPS = 30
LEN, WID = 40, 30
PX = 18  # xaritada 1 m
MARGIN = 30
TILE_W, TILE_H = 960, 540
COLORS = {'yashil': (60, 230, 120), "ko'k": (230, 120, 40)}
GREY = (150, 150, 150)
SMOOTH = 15  # 0.5 s — masofada titrash yig'ilmasin


def homography(cam: str, calib: dict) -> np.ndarray:
    p = calib['nuqtalar'][cam]
    return cv2.getPerspectiveTransform(np.float32(p['kadr']), np.float32(p['maydon']))


def positions(prefix: str, cam: str, calib: dict) -> tuple[dict, dict, np.ndarray]:
    """{odam: {kadr: (x, y)}}, nomsiz treklar {kadr: [(x, y)]} va kadrdagi ramkalar."""
    res = analyse(prefix, cam, calib[cam])
    rows = np.load(prefix + '.tracks.npy')
    poly = np.array(calib[cam], np.int32)
    H = homography(cam, calib)
    feet = np.c_[(rows[:, 2] + rows[:, 4]) / 2, rows[:, 5]].astype(np.float32)
    xy = cv2.perspectiveTransform(feet[None], H)[0]
    owner = {tid: name for name, p in res['odamlar'].items() for tid in p['treklar']}
    named: dict[str, dict[int, np.ndarray]] = {}
    unnamed: dict[int, list] = {}
    for r, f, p in zip(rows, feet, xy):
        if cv2.pointPolygonTest(poly, (float(f[0]), float(f[1])), False) < 0:
            continue
        i, tid = int(r[0]), int(r[1])
        if tid in owner:
            named.setdefault(owner[tid], {})[i] = p
        else:
            unnamed.setdefault(i, []).append(p)
    return named, unnamed, rows


def fuse(per_cam: list[dict], n: int) -> dict[str, np.ndarray]:
    """Har odam uchun (n, 2) trayektoriya: kameralar o'rtachasi, bo'shliqlar NaN, so'ng silliqlanadi."""
    out = {}
    for name in set().union(*per_cam):
        pts = np.full((n, 2), np.nan)
        for i in range(n):
            seen = [c[name][i] for c in per_cam if name in c and i in c[name]]
            if seen:
                pts[i] = np.mean(seen, axis=0)
        k = np.ones(SMOOTH) / SMOOTH
        valid = ~np.isnan(pts[:, 0])
        sm = pts.copy()
        for d in range(2):
            filled = np.where(valid, pts[:, d], 0)
            w = np.convolve(valid.astype(float), k, 'same')
            sm[:, d] = np.where(valid, np.convolve(filled, k, 'same') / np.maximum(w, 1e-9), np.nan)
        out[name] = sm
    return out


def distance(traj: np.ndarray) -> float:
    step = np.linalg.norm(np.diff(traj, axis=0), axis=1)
    return float(np.nansum(step[step < 0.5]))  # 0.5 m/kadr (15 m/s) dan katta sakrash — xato


def to_px(p) -> tuple[int, int]:
    return int(MARGIN + (p[0] + LEN / 2) * PX), int(MARGIN + p[1] * PX)


def pitch() -> np.ndarray:
    w, h = LEN * PX + 2 * MARGIN, WID * PX + 2 * MARGIN
    img = np.full((h, w, 3), (40, 110, 50), np.uint8)
    white = (235, 235, 235)
    cv2.rectangle(img, to_px((-LEN / 2, 0)), to_px((LEN / 2, WID)), white, 2)
    cv2.line(img, to_px((0, 0)), to_px((0, WID)), white, 2)
    cv2.circle(img, to_px((0, WID / 2)), 3 * PX, white, 2)
    for s in (-1, 1):
        cv2.line(img, to_px((s * LEN / 2, WID / 2 - 1.5)), to_px((s * LEN / 2, WID / 2 + 1.5)), (255, 255, 255), 6)
    return img


def main(out: str, *args: str) -> None:
    calib = json.load(open('calib.json'))
    cams = []
    for i in range(0, len(args), 4):
        src, start, prefix, cam = args[i : i + 4]
        cap = cv2.VideoCapture(src)
        cap.set(cv2.CAP_PROP_POS_MSEC, float(start) * 1000)
        named, unnamed, rows = positions(prefix, cam, calib)
        cams.append({'cap': cap, 'named': named, 'unnamed': unnamed, 'rows': rows})
    n = int(min(c['rows'][:, 0].max() for c in cams)) + 1
    traj = fuse([c['named'] for c in cams], n)
    dist = {k: distance(v) for k, v in traj.items()}
    base = pitch()
    writer = None
    for i in range(n):
        tiles = []
        for c in cams:
            ok, frame = c['cap'].read()
            tiles.append(cv2.resize(frame, (TILE_W, TILE_H)) if ok else np.zeros((TILE_H, TILE_W, 3), np.uint8))
        m = base.copy()
        for c in cams:
            for p in c['unnamed'].get(i, []):
                if -LEN / 2 - 2 < p[0] < LEN / 2 + 2 and -2 < p[1] < WID + 2:
                    cv2.circle(m, to_px(p), 5, GREY, -1)
        for name, t in traj.items():
            if np.isnan(t[i, 0]):
                continue
            color = COLORS.get(name.split(' #')[0], GREY)
            cv2.circle(m, to_px(t[i]), 10, color, -1)
            cv2.putText(m, name.split(' ')[-1], (to_px(t[i])[0] + 12, to_px(t[i])[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
        side = np.full((TILE_H, TILE_W * len(cams) - TILE_H * m.shape[1] // m.shape[0], 3), 24, np.uint8)
        cv2.putText(side, 'Maydon xaritasi (40 x 30 m)', (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (230, 230, 230), 2, cv2.LINE_AA)
        for j, name in enumerate(sorted(traj)):
            color = COLORS.get(name.split(' #')[0], GREY)
            cv2.putText(side, name.replace("'", "'").upper(), (30, 100 + j * 38), cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2, cv2.LINE_AA)
        cv2.putText(side, 'kulrang - raqami aniqlanmagan', (30, TILE_H - 55), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (170, 170, 170), 1, cv2.LINE_AA)
        cv2.putText(side, 'taxminiy: kameralar orasidagi farq ~2 m', (30, TILE_H - 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (170, 170, 170), 1, cv2.LINE_AA)
        img = np.vstack([np.hstack(tiles), np.hstack([cv2.resize(m, (TILE_H * m.shape[1] // m.shape[0], TILE_H)), side])])
        if writer is None:
            writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'MJPG'), FPS, (img.shape[1], img.shape[0]))
        writer.write(img)
    writer.release()
    print(json.dumps({k: round(v) for k, v in sorted(dist.items())}, ensure_ascii=False))


if __name__ == '__main__':
    main(*sys.argv[1:])
