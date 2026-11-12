"""Treklardan o'yinchilar: maydondan tashqaridagilar chiqariladi, raqami bir xil treklar bitta odam (AI_CAM.md §13.1).

    python post.py out/R420 R [out/L631 L ...]
"""

import collections
import json
import sys

import cv2
import numpy as np

FPS = 30
# Raqam qabul qilinadi: ikki xonali — yig'ma ishonch ≥ 3; bir xonali — ≥ 5 va shu trekda uni o'z ichiga olgan ikki xonali yo'q
# (yashil jiletkada "16" ko'pincha "1" yoki "6" bo'lib chala o'qiladi)
MIN_SCORE_2, MIN_SCORE_1 = 3.0, 5.0


def track_number(votes: dict[str, float]) -> str | None:
    two = {k: v for k, v in votes.items() if len(k) == 2 and v >= MIN_SCORE_2}
    if two:
        return max(two, key=two.get)
    one = {k: v for k, v in votes.items() if len(k) == 1 and v >= MIN_SCORE_1 and not any(k in t for t in votes if len(t) == 2)}
    return max(one, key=one.get) if one else None


def analyse(prefix: str, cam: str, polygon: list) -> dict:
    rows = np.load(prefix + '.tracks.npy')
    info = json.load(open(prefix + '.json'))
    poly = np.array(polygon, np.int32)
    feet = np.c_[(rows[:, 2] + rows[:, 4]) / 2, rows[:, 5]]
    inside = np.array([cv2.pointPolygonTest(poly, (float(x), float(y)), False) >= 0 for x, y in feet])
    on_pitch = collections.Counter(rows[inside, 1].astype(int))
    people: dict[str, dict] = {}
    unknown_frames = 0
    for tid, n in on_pitch.items():
        t = info[str(tid)]
        if n < 15:  # 0.5 s dan qisqa — shovqin
            continue
        team = max(t['jamoa'], key=t['jamoa'].get) if t['jamoa'] else None
        num = track_number(t['raqam'])
        if num is None:
            unknown_frames += n
            continue
        p = people.setdefault(f'{team} #{num}', {'treklar': [], 'kadr': 0})
        p['treklar'].append(int(tid))
        p['kadr'] += n
    total = sum(n for n in on_pitch.values() if n >= 15)
    named = total - unknown_frames
    return {
        'kamera': cam,
        'maydondagi_treklar': sum(1 for n in on_pitch.values() if n >= 15),
        'tashqaridagi_kadrlar': int((~inside).sum()),
        'raqam_aniqlangan_ulush': round(named / total, 2) if total else 0,
        'odamlar': {k: {'treklar': v['treklar'], 'soniya': round(v['kadr'] / FPS, 1)} for k, v in sorted(people.items())},
    }


if __name__ == '__main__':
    calib = json.load(open('calib.json'))
    args = sys.argv[1:]
    results = [analyse(args[i], args[i + 1], calib[args[i + 1]]) for i in range(0, len(args), 2)]
    for r in results:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    if len(results) > 1:
        names = [set(r['odamlar']) for r in results]
        print('Ikkala kamerada:', sorted(set.intersection(*names)))
        print('Hammasi:', sorted(set.union(*names)))
