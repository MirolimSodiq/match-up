"""Kamera kalibrovkasi: kadr pikseli → maydon (m). Natija calib.json["H"] ga yoziladi.

    python calibrate.py "<chap>" 631 out/L631 "<o'ng>" 632.55 out/R632

1. Kadrdagi oq chiziqlar (top-hat) calib.json["chiziqlar"] dagi taxminiy shakllar atrofidan yig'iladi:
   o'rta chiziq (x=0), yaqin chet (y=30), darvoza chizig'i (x=±20), markaziy aylana (radius noma'lum).
2. Har kamera uchun poza (6) + fokus fit qilinadi: chiziqlar + markazdagi to'p + darvoza ustunlari (eni noma'lum).
3. Ikkala kamera bir lahzada ko'rgan bir odam (raqam bo'yicha) — qo'shimcha cheklov: xaritada bir nuqtaga tushsin.
   Halollik uchun avval birinchi yarim kadrlar bilan fit, ikkinchi yarmida tekshiriladi; saqlanadigani — hammasi bilan.
"""

import contextlib
import io
import json
import sys

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import cKDTree

import pitchmap

PAIR_WEIGHT = 20  # 1 m kelishmovchilik ≈ 20 px chiziq xatosi


def frame(src: str, start: float) -> np.ndarray:
    cap = cv2.VideoCapture(src)
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    ok, img = cap.read()
    assert ok, src
    return img


def line_mask(img: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    th = cv2.morphologyEx(hsv[..., 2], cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    return (th > 35) & (hsv[..., 1] < 90)


def ellipse_pts(c, ax, ang, n):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    a = np.radians(ang)
    x, y = ax[0] * np.cos(t), ax[1] * np.sin(t)
    return np.c_[c[0] + x * np.cos(a) - y * np.sin(a), c[1] + x * np.sin(a) + y * np.cos(a)]


def samples(img: np.ndarray, guide: dict) -> dict:
    ys, xs = np.nonzero(line_mask(img))
    P = np.c_[xs, ys].astype(float)
    res = {}
    for key in ('half', 'near', 'end'):
        pts = []
        for a, b in guide.get(key, []):
            a, b = np.array(a, float), np.array(b, float)
            u = (b - a) / np.linalg.norm(b - a)
            t, off = (P - a) @ u, (P - a) @ np.array([-u[1], u[0]])
            sel = (t > 0) & (t < np.linalg.norm(b - a)) & (np.abs(off) < 25)
            Q, ts, os_ = P[sel], t[sel], off[sel]
            for _ in range(3):  # o'yinchi/soya shovqinini chiqarish
                r = np.abs(os_ - np.polyval(np.polyfit(ts, os_, 1), ts))
                keep = r < max(6, np.percentile(r, 60))
                Q, ts, os_ = Q[keep], ts[keep], os_[keep]
            bins = (ts // 25).astype(int)
            pts += [np.median(Q[bins == k], axis=0) for k in np.unique(bins) if (bins == k).sum() >= 5]
        if pts:
            res[key] = np.array(pts)
    c, ax, ang = guide['circle']
    e = ((c[0], c[1]), (2 * ax[0], 2 * ax[1]), ang)
    for tol in (22, 8, 8, 8):
        d, _ = cKDTree(ellipse_pts(e[0], (e[1][0] / 2, e[1][1] / 2), e[2], 2000)).query(P)
        e = cv2.fitEllipse(P[d < tol].astype(np.float32))
    res['circle'] = ellipse_pts(e[0], (e[1][0] / 2, e[1][1] / 2), e[2], 48)
    return res


def K(f):
    return np.array([[f, 0, 1920], [0, f, 1080], [0, 0, 1.0]])


def H(p):  # maydon (m) → piksel; p = rvec(3), tvec(3), f
    R, _ = cv2.Rodrigues(p[:3])
    return K(p[6]) @ np.c_[R[:, 0], R[:, 1], p[3:6]]


def apply(Hm, pts):
    q = np.c_[pts, np.ones(len(pts))] @ Hm.T
    return q[:, :2] / q[:, 2:]


def fit(cams: dict, smp: dict, pairs: np.ndarray, z0: list) -> np.ndarray:
    def resid(z):
        p = {'L': z[:7], 'R': z[7:14]}
        w, r = z[14], z[15]
        out = []
        for cam, g in cams.items():
            Hm, s = H(p[cam]), smp[cam]
            out += list((apply(Hm, [(0, 15)]) - [g['top']]).ravel() * 0.5)  # boshlang'ich to'p markazda (taxminan)
            for uv, sgn in g['ustunlar']:
                out += list((apply(Hm, [(g['darvoza_x'], 15 + sgn * w / 2)]) - [uv]).ravel())

            def snap(key, f):
                if key not in s:
                    return []
                gp = apply(np.linalg.inv(Hm), s[key])
                return list(np.linalg.norm(apply(Hm, f(gp)) - s[key], axis=1))

            out += snap('half', lambda g_: np.c_[np.zeros(len(g_)), g_[:, 1]])
            out += snap('near', lambda g_: np.c_[g_[:, 0], np.full(len(g_), 30.0)])
            out += snap('end', lambda g_: np.c_[np.full(len(g_), g['darvoza_x']), g_[:, 1]])
            out += snap('circle', lambda g_: [0, 15] + (g_ - [0, 15]) / np.linalg.norm(g_ - [0, 15], axis=1, keepdims=True) * r)
        if len(pairs):
            gl = apply(np.linalg.inv(H(p['L'])), pairs[:, 1:3])
            gr = apply(np.linalg.inv(H(p['R'])), pairs[:, 3:5])
            out += list(np.linalg.norm(gl - gr, axis=1) * PAIR_WEIGHT)
        return np.array(out)

    return least_squares(resid, z0, loss='soft_l1', f_scale=4).x


def disagreement(z, pairs) -> np.ndarray:
    gl = apply(np.linalg.inv(H(z[:7])), pairs[:, 1:3])
    gr = apply(np.linalg.inv(H(z[7:14])), pairs[:, 3:5])
    return np.linalg.norm(gl - gr, axis=1)


def foot_pairs(calib: dict, prefixes: dict) -> np.ndarray:
    """(kadr, uL, vL, uR, vR): bir odam (jamoa + raqam) bir kadrda ikkala kamerada."""
    real = pitchmap.homography
    pitchmap.homography = lambda cam, c: np.eye(3)  # piksel holida qaytsin
    with contextlib.redirect_stdout(io.StringIO()):
        L, _, _ = pitchmap.positions(prefixes['L'], 'L', calib)
        R, _, _ = pitchmap.positions(prefixes['R'], 'R', calib)
    pitchmap.homography = real
    return np.array([(i, *L[n][i], *R[n][i]) for n in set(L) & set(R) for i in sorted(set(L[n]) & set(R[n]))])


def main(*args: str) -> None:
    calib = json.load(open('calib.json'))
    cams = {k: v for k, v in calib['chiziqlar'].items() if k in ('L', 'R')}
    smp, prefixes, z0 = {}, {}, []
    for i in range(0, len(args), 3):
        src, start, prefix = args[i : i + 3]
        cam = 'L' if i == 0 else 'R'
        g = cams[cam]
        smp[cam] = samples(frame(src, float(start)), g)
        prefixes[cam] = prefix
        obj = np.array([[0, 15, 0], [g['darvoza_x'], 15 + g['ustunlar'][0][1] * 1.5, 0], [g['darvoza_x'], 15 + g['ustunlar'][1][1] * 1.5, 0], [0, 30, 0]], float)
        img = np.array([g['top'], g['ustunlar'][0][0], g['ustunlar'][1][0], g['yaqin_markaz']], float)
        _, rv, tv = cv2.solvePnP(obj, img, K(2800), None, flags=cv2.SOLVEPNP_IPPE)
        z0 += [*rv.ravel(), *tv.ravel(), 2800.0]
        print(cam, {k: len(v) for k, v in smp[cam].items()})
    z0 += [3.0, 3.0]
    pairs = foot_pairs(calib, prefixes)
    half = pairs[:, 0].max() / 2
    train, test = pairs[pairs[:, 0] < half], pairs[pairs[:, 0] >= half]
    z_lines = fit(cams, smp, np.empty((0, 5)), z0)
    z_half = fit(cams, smp, train, z_lines)
    z = fit(cams, smp, pairs, z_half)
    report = {
        'faqat_chiziqlar_median_m': round(float(np.median(disagreement(z_lines, test))), 2),
        'chiziqlar_va_juftliklar_median_m': round(float(np.median(disagreement(z_half, test))), 2),
        'tekshiruv_kadrlari': len(test),
        'darvoza_eni_m': round(float(z[14]), 2),
        'aylana_radiusi_m': round(float(z[15]), 2),
    }
    for cam, p in (('L', z[:7]), ('R', z[7:14])):
        R, _ = cv2.Rodrigues(p[:3])
        C = -R.T @ p[3:6]
        report[f'kamera_{cam}'] = {'x': round(float(C[0]), 1), 'y': round(float(C[1]), 1), 'balandlik_m': round(abs(float(C[2])), 2), 'fokus_px': round(float(p[6]))}
    print(json.dumps(report, ensure_ascii=False, indent=1))
    calib['H'] = {'_izoh': 'kadr pikseli → maydon (m), calibrate.py natijasi', **{c: np.linalg.inv(H(p)).tolist() for c, p in (('L', z[:7]), ('R', z[7:14]))}}
    calib['kalibrovka_natijasi'] = report
    json.dump(calib, open('calib.json', 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:])
