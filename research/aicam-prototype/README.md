# AI-Cam prototipi (Bosqich B)

Tayyor ochiq modellar bilan pilot videolarida tajriba: o'yinchini topish, kuzatish, jamoa (jiletka rangi) va jiletka raqami. Mahsulot kodi emas — media-worker'ga hech narsa ulanmagan. Reja va qarorlar: [`docs/AI_CAM.md`](../../docs/AI_CAM.md) §3, §13, §14.

| Fayl | Nima qiladi |
|---|---|
| `run.py` | videoning bir qismi → belgilangan video (`.avi`) va treklar (`.json`: kadrlar soni, jamoa ovozlari, raqam ovozlari) |
| `vest.py` | jamoa — torsdagi jiletka rangi ulushi (HSV); raqam — EasyOCR, asl kesim va oq piksellar niqobi |
| `tracker.py` | oddiy IoU kuzatuvchi (ByteTrack o'rniga, vaqtincha) |
| `post.py` | maydon chegarasi (`calib.json`) bo'yicha tomoshabinlar chiqariladi; treklar raqamga ko'ra bitta odamga birlashtiriladi (raqam — odam, §13.1); kameralar ro'yxati |
| `render.py` | ikki kamera yonma-yon + ro'yxat paneli; yorliq trekning yakuniy raqamidan — raqam o'qilishidan oldingi kadrlarda ham |
| `reel.py` | bitta o'yinchi videosi (player reel, §4): o'yinchini kuzatuvchi 720×720 kadr, belgi, raqam va jamoa; o'yinchi yaqinroq ko'ringan kameraga o'tadi. Reyting va harakat yorliqlari yo'q — hali hisoblanmaydi |
| `calib.json` | har kamera kadridagi maydon chegarasi (qo'lda, taxminiy) |

Modellar: [RF-DETR](https://github.com/roboflow/rf-detr) Medium (COCO: `person`, `sports ball`), [EasyOCR](https://github.com/JaidedAI/EasyOCR). Litsenziyalar — Apache-2.0 / MIT / BSD (§14.3). Og'irliklar birinchi ishga tushishda yuklanadi: `~/.roboflow/models` (~390 MB) va `~/.EasyOCR`.

## Ishga tushirish

```bash
cd research/aicam-prototype
uv venv --python 3.12 && uv pip install -e .
mkdir -p out
uv run python run.py "/yo'l/video.MOV" 420 60 out/R420
uv run python post.py out/R420 R out/L631 L
uv run python reel.py out/reel20.avi "ko'k #20" 30 "<chap>" 631 out/L631 L "<o'ng>" 420 out/R420 R
uv run python render.py out/both.avi "<chap>" 631 out/L631 L "<o'ng>" 420 out/R420 R
```

Videolar va natijalar repoga qo'shilmaydi (`.gitignore`) — kadrda rozilik bermagan odamlar bor (§8). Apple M1 (8 GB): 60 s 4K video ≈ 18 daqiqa (topish MPS'da ~0.2 s/kadr, qolgani — CPU'dagi OCR).

## Birinchi natija (2026-11-12 pilot, o'ng kamera, 60 s)

| Vazifa | Natija |
|---|---|
| O'yinchini topish | hammasi, narigi darvozabon ham; chetdagi tomoshabinlar ham (maydon chegarasi yo'q) |
| Jamoa | har trekda 90–100% bir rang |
| Raqam, ko'k jiletka (oq raqam) | 17, 11, 20, 14 — aniq |
| Raqam, neon yashil jiletka (oq raqam) | faqat 15; qolganlari chala ("0", "1") — kontrast yetmaydi (§1.1, §13.2) |
| Kuzatish | ~12 kishiga 75 trek — to'silganda uziladi |
| To'p | ba'zan; bir marta chiroqni to'p deb oldi |

## Ikki kamera, raqam bo'yicha birlashtirish (2026-11-13)

Bir xil 60 soniya: o'ng 420 s, chap 631 s (boshlanish vaqtlari farqi 211 s, ±1 s).

| | Chap (L) | O'ng (R) |
|---|---|---|
| Maydondagi treklar | 42 | 48 |
| Raqami aniqlangan vaqt (o'yinchi × kadr) | 43% | 41% |
| Topilgan odamlar | ko'k 12, 14, 17, 18, 19, 20; yashil 17 | ko'k 11, 14, 17, 20; yashil 0, 15 |
| Birlashtirilgan treklar | #20: 4 trek → 1 | #20: 3 → 1, #11 va #17: 2 → 1 |

Ikkala kamerada: ko'k 14, 17, 20. Xatolar bor va haqiqiy ro'yxat bilan solishtirilmagan: "yashil #0" — chala o'qish; chapdagi "ko'k #18" kadrda "10" ga o'xshaydi; "yashil #17" shubhali. Aniqlikni o'lchash uchun belgilangan kadrlar (ground truth) kerak.

## Keyingi qadamlar

1. ByteTrack; raqam diapazoni tekshiruvi (rang ↔ o'nlik xona, §13.2) — "ko'k #18" kabi xatolarni kesadi.
2. Kalibrovka: maydon chiziqlaridan homography (maydon o'lchami kerak) — hozircha faqat qo'lda chizilgan chegara.
3. Ikki kamera → bitta maydon xaritasi (yuqoridan ko'rinish, metrlarda).
4. CVAT'da belgilash (to'p, raqam, maydon nuqtalari) va fine-tune (§14.4).
