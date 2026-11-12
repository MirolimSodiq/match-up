# AI-Cam prototipi (Bosqich B)

Tayyor ochiq modellar bilan pilot videolarida tajriba: o'yinchini topish, kuzatish, jamoa (jiletka rangi) va jiletka raqami. Mahsulot kodi emas — media-worker'ga hech narsa ulanmagan. Reja va qarorlar: [`docs/AI_CAM.md`](../../docs/AI_CAM.md) §3, §13, §14.

| Fayl | Nima qiladi |
|---|---|
| `run.py` | videoning bir qismi → belgilangan video (`.avi`) va treklar (`.json`: kadrlar soni, jamoa ovozlari, raqam ovozlari) |
| `vest.py` | jamoa — torsdagi jiletka rangi ulushi (HSV); raqam — EasyOCR, asl kesim va oq piksellar niqobi |
| `tracker.py` | oddiy IoU kuzatuvchi (ByteTrack o'rniga, vaqtincha) |

Modellar: [RF-DETR](https://github.com/roboflow/rf-detr) Medium (COCO: `person`, `sports ball`), [EasyOCR](https://github.com/JaidedAI/EasyOCR). Litsenziyalar — Apache-2.0 / MIT / BSD (§14.3). Og'irliklar birinchi ishga tushishda yuklanadi: `~/.roboflow/models` (~390 MB) va `~/.EasyOCR`.

## Ishga tushirish

```bash
cd research/aicam-prototype
uv venv --python 3.12 && uv pip install -e .
mkdir -p out
uv run python run.py "/yo'l/video.MOV" 420 60 out/R420
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

## Keyingi qadamlar

1. Treklarni raqam bo'yicha birlashtirish (raqam — odam, §13.1); ByteTrack.
2. Maydon chegarasi va kalibrovka: maydon chiziqlaridan homography, tashqaridagilar chiqarib tashlanadi.
3. Ikki kamera → bitta maydon xaritasi (yuqoridan ko'rinish, metrlarda).
4. CVAT'da belgilash (to'p, raqam, maydon nuqtalari) va fine-tune (§14.4).
