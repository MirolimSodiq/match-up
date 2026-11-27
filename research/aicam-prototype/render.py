"""Ikki kamera yonma-yon + o'yinchilar ro'yxati. Yorliq treknining yakuniy raqamidan — butun klip davomida bir xil.

    python render.py out/both.avi "<chap video>" 631 out/L631 L "<o'ng video>" 420 out/R420 R
"""

import json
import sys

import cv2
import numpy as np

from post import analyse

COLORS = {'yashil': (60, 230, 120), "ko'k": (230, 120, 40)}
GREY = (170, 170, 170)
TILE_W, TILE_H = 960, 540


def labels(prefix: str, cam: str, polygon: list) -> tuple[dict[int, tuple[str, tuple]], dict]:
    res = analyse(prefix, cam, polygon)
    out = {}
    for name, p in res['odamlar'].items():
        team = name.split(' #')[0]
        for tid in p['treklar']:
            out[tid] = (name.split(' ')[-1], COLORS.get(team, GREY))
    return out, res


def main(out: str, *cams: str) -> None:
    calib = json.load(open('calib.json'))
    feeds = []
    for i in range(0, len(cams), 4):
        src, start, prefix, cam = cams[i : i + 4]
        cap = cv2.VideoCapture(src)
        cap.set(cv2.CAP_PROP_POS_MSEC, float(start) * 1000)
        rows = np.load(prefix + '.tracks.npy')
        lab, res = labels(prefix, cam, calib[cam])
        feeds.append({'cap': cap, 'rows': rows, 'lab': lab, 'res': res, 'poly': np.array(calib[cam], np.int32)})
    n = int(min(f['rows'][:, 0].max() for f in feeds)) + 1
    writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*'MJPG'), 30, (TILE_W * len(feeds), TILE_H * 2))
    roster = panel(feeds)
    for i in range(n):
        tiles = []
        for f in feeds:
            ok, frame = f['cap'].read()
            img = cv2.resize(frame, (TILE_W, TILE_H)) if ok else np.zeros((TILE_H, TILE_W, 3), np.uint8)
            s = TILE_W / frame.shape[1] if ok else 1
            for row in f['rows'][f['rows'][:, 0] == i]:
                tid, box = int(row[1]), row[2:]
                foot = (float((box[0] + box[2]) / 2), float(box[3]))
                if cv2.pointPolygonTest(f['poly'], foot, False) < 0:
                    continue
                text, color = f['lab'].get(tid, ('?', GREY))
                x1, y1, x2, y2 = (box * s).astype(int)
                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2 if text != '?' else 1)
                if text != '?':
                    cv2.putText(img, text, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)
            tiles.append(img)
        writer.write(np.vstack([np.hstack(tiles), roster]))
    writer.release()


def panel(feeds) -> np.ndarray:
    img = np.full((TILE_H, TILE_W * len(feeds), 3), 24, np.uint8)
    for k, f in enumerate(feeds):
        r, x = f['res'], k * TILE_W + 40
        cv2.putText(img, f"Kamera {r['kamera']}: raqami aniqlangan vaqt {int(r['raqam_aniqlangan_ulush'] * 100)}%", (x, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (230, 230, 230), 2, cv2.LINE_AA)
        for j, (name, p) in enumerate(r['odamlar'].items()):
            team = name.split(' #')[0]
            cv2.putText(img, f"{name.split(' ')[-1]:>4}  {p['soniya']:>5.1f} s", (x, 120 + j * 44), cv2.FONT_HERSHEY_SIMPLEX, 0.9, COLORS.get(team, GREY), 2, cv2.LINE_AA)
    return img


if __name__ == '__main__':
    main(sys.argv[1], *sys.argv[2:])
