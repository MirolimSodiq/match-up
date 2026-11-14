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
| `pitchmap.py` | ikki kamera → bitta maydon xaritasi (yuqoridan, metrda): har kamera homography'si, odam bo'yicha birlashtirish, 0.5 s silliqlash |
| `calibrate.py` | kamera kalibrovkasi: kadrdagi oq chiziqlar (o'rta chiziq, chet, aylana, darvoza) + ikkala kamerada ko'ringan bir odam → har kamera pozasi va homography (kadr → metr) |
| `calib.json` | maydon chegarasi (qo'lda), chiziqlarning taxminiy joyi, `calibrate.py` natijasi (`H`) va ikki video orasidagi vaqt farqi |

Modellar: [RF-DETR](https://github.com/roboflow/rf-detr) Medium (COCO: `person`, `sports ball`), [EasyOCR](https://github.com/JaidedAI/EasyOCR). Litsenziyalar — Apache-2.0 / MIT / BSD (§14.3). Og'irliklar birinchi ishga tushishda yuklanadi: `~/.roboflow/models` (~390 MB) va `~/.EasyOCR`.

## Ishga tushirish

```bash
cd research/aicam-prototype
uv venv --python 3.12 && uv pip install -e .
mkdir -p out
uv run python run.py "/yo'l/video.MOV" 420 60 out/R420
uv run python post.py out/R420 R out/L631 L
uv run python reel.py out/reel20.avi "ko'k #20" 30 "<chap>" 631 out/L631 L "<o'ng>" 420 out/R420 R
uv run python calibrate.py "<chap>" 631 out/L631 "<o'ng>" 632.55 out/R632
uv run python pitchmap.py out/map.avi "<chap>" 631 out/L631 L "<o'ng>" 632.55 out/R632 R
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

## Ikki kamera va maydon xaritasi (2026-11-13)

**Sinxron.** Fayllardagi boshlanish vaqti (`creationdate`) bo'yicha farq 211 s chiqqan edi — noto'g'ri: chap fayl eksportda qirqilgan. Ovoz korrelyatsiyasi (spectral flux, uch oynada bir xil natija) va o'yin boshlanishi (to'p markazda, ikkala kadrda) bo'yicha **chap = o'ng − 1.55 s**. Shu sababli birinchi "ikki kamera" videosi (`R420` + `L631`) ikki xil lahzani ko'rsatgan — u bekor, o'rniga `R632` + `L631`.

| | Chap (L, 631 s) | O'ng (R, 632.55 s) |
|---|---|---|
| Raqami aniqlangan vaqt (o'yinchi × kadr) | 43% | ~40% |
| Ikkala kamerada topilganlar | ko'k 12, 17, 18, 19, 20 | |

**Kalibrovka.** Maydon 40 × 30 m. Birinchi urinish — har kamerada qo'lda 4 nuqta (darvoza eni 5 m deb olingan): kameralar orasidagi farq **median ~2.3 m**; darvoza enini 3 m qilinganda ~6 m'ga yomonlashdi — demak xato nuqtalarda edi. Bundan tashqari kameralar teskari belgilangan edi: joylashuv kesishgan — **chap kamera o'ng darvozani, o'ng kamera chap darvozani oladi** (xarita ko'zgudagidek chiqqan).

`calibrate.py` (2026-11-14): kadrdan oq chiziqlar avtomatik yig'iladi (o'rta chiziq ~90, chet ~15, aylana 48 nuqta), har kamera pozasi va fokus fit qilinadi; darvoza eni va aylana radiusi noma'lum parametr. So'ng ikkala kamerada bir lahzada ko'ringan bir odam (raqam bo'yicha) qo'shimcha cheklov sifatida qo'shiladi. Tekshiruv — fit'da qatnashmagan ikkinchi 30 s:

| | Kameralar orasidagi farq (median) |
|---|---|
| Qo'lda 4 nuqta | 2.3 m |
| Faqat chiziqlar | 1.27 m |
| Chiziqlar + ikki kamera juftliklari | **0.86 m** |

Fit natijasi: telefonlar taxminan maydon burchaklarida (x ≈ ±20, yaqin chet), balandlik ~4.2 m, fokus ~3350 px (gorizontal ko'rish burchagi ~60°). Darvoza eni ~4.3 m, aylana radiusi ~3.5 m chiqadi — haqiqatda darvoza 2–3 m bo'lsa, "40 × 30" chiziqdan chiziqqacha emas (to'r bilan birga) bo'lishi mumkin: bu holda butun masshtab (va balandlik) kichrayadi. Chiziqdan chiziqqacha o'lcham kerak. Linza buzilishi (k1) natijaga ta'sir qilmadi — hisobga olinmaydi. p90 ~17 m — noto'g'ri o'qilgan raqamlar (ikki kamerada boshqa-boshqa odam bir xil raqam bilan). Masofa hali faqat konsolga chiqadi.

Xatolar: ba'zi raqamlar noto'g'ri o'qilgan ("ko'k #18" — "10" bo'lishi mumkin; "yashil #17" shubhali). Aniqlikni o'lchash uchun belgilangan kadrlar (ground truth) kerak.

## Keyingi qadamlar

1. ByteTrack; raqam diapazoni tekshiruvi (rang ↔ o'nlik xona, §13.2) — "ko'k #18" kabi xatolarni kesadi.
2. Kalibrovka: maydon o'lchamlarini chiziqdan chiziqqacha o'lchash; chiziqlar joyini qo'lda emas, maydon keypoint/chiziq modeli bilan topish (yangi kamera joyi — o'qitishsiz, avtomatik); maqsad — kameralar orasidagi farq < 0.5 m. Sinxron — boshida qarsak (ovoz bo'yicha avtomatik).
3. CVAT'da belgilash (to'p, raqam, maydon nuqtalari) va fine-tune (§14.4).
