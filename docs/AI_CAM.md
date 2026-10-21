# AI-Cam Engine — video highlight'lar va o'yinchi reytingi

> Maydondagi 2–3 telefon yozuvidan butun maydon ko'rinishi, avtomatik highlight kliplar (gol, dribling, progressiv pas) va har bir o'yinchi uchun FIFA uslubidagi reyting (masalan, **8.7**) yaratadigan modul.
> Holat: **reja (Phase 2)**. MVP'da faqat host qo'lda yozadigan qisqa kliplar bor (`docs/ARCHITECTURE.md` §4.10).

| Bog'liq joy | Nima bor |
|---|---|
| `highlights`, `media_assets` (0001) | klip va fayl yozuvlari |
| `match_events` (0002) | `source = 'ai'`, `confidence`, `match_offset_ms` |
| `media_processing_jobs` (0002, 0008) | `ai_detect_events`, `ai_auto_clip`, `face_blur` job turlari; 0008 dan `stage`, `transport` (`redis_stream` / `sqs`), `message_id`, `heartbeat_at` |
| `services/media-worker` | Python worker (highlight transcode, `ARCHITECTURE.md` §4.10): `JobSource` (navbat), `Api` (ichki endpointlar), `Storage` (S3), idempotent bosqichli `Pipeline` — AI-Cam `services/ai-cam` shu qatlamlar ustiga quriladi |
| API Media moduli | presigned multipart (resume bilan), `MediaJobQueue` + `JOB_ROUTES` (`ai_*` → `sqs`), `/internal/media/jobs/{id}/start\|progress\|result`, HLS playlist imzolash |

---

## 1. Maydondagi ish oqimi

```mermaid
sequenceDiagram
    autonumber
    participant H as Host app
    participant API as API
    participant S3 as S3 (raw/)
    participant Q as SQS
    participant GPU as AWS Batch GPU (Python)
    participant P as Player app
    H->>API: POST /host/matches/{id}/recordings (kameralar: left, right)
    API-->>H: recording_id + har kamera uchun multipart upload
    Note over H: Rig o'rnatiladi, yozish boshlanadi,<br/>sinxron signal (hushtak/qarsak)
    H->>S3: o'yindan keyin: qismlarga bo'lib, davom ettiriladigan upload (Wi-Fi)
    H->>API: .../cameras/{cam}/complete (ETag'lar, checksum)
    API->>Q: AiCamJobQueued (ikkala kamera tayyor bo'lganda)
    Q->>GPU: pipeline: sync → kalibrovka → detect/track → identity → event → reyting → render
    GPU->>API: natijalar (stats, events, kliplar) + outbox
    API-->>P: push + WS analytics.ready
    P->>API: GET /matches/{id}/analytics
```

**Rig (host olib yuradigan to'plam):**
- 5 metrli teleskopik shtativ markaziy chiziqda, maydon chetida. 2 ta telefon (iPhone 11+): **A** — chap yarim maydon, **B** — o'ng yarim maydon. Markaziy doira atrofida ikkala kadr ~10–15% ustma-ust tushadi (kalibrovka va stitching uchun).
- Ixtiyoriy 3-telefon: keng burchakli umumiy kadr (zaxira va sinxronlash uchun).
- **Raqamli bib'lar** (oldi va orqasida katta raqam, ikki rang). Pickup o'yinlarda futbolka raqami yo'q, shuning uchun o'yinchini tanish faqat bib raqami orqali ishonchli ishlaydi. Host check-in paytida har o'yinchiga bib raqamini biriktiradi (§5).
- Power bank va soya: 90+ daqiqa 4K yozuvda iPhone qiziydi. Yozda Toshkentda 40°C — bu real xavf (§10).

**Yozish sozlamalari (host app yozadi, oddiy kamera ilovasi emas):**
- 4K 30 fps HEVC, ekspozitsiya va fokus qulflangan, stabilizatsiya o'chiq. Stabilizatsiya kadrni siljitib, kalibrovkani buzadi.
- Boshlashdan oldin tekshiruvlar: bo'sh joy ≥ 40 GB, batareya ≥ 80% yoki quvvatga ulangan, ikkala telefon soati NTP bo'yicha.
- Hajm: ~15 GB / telefon / 90 daqiqa → bitta match ≈ 30 GB. Mobil internet orqali yuklash amalda imkonsiz. Upload Wi-Fi'da, fonda, qismlarga bo'lib va uzilsa davom ettiriladigan (resumable) bo'ladi. Fayl serverda checksum tasdiqlanmaguncha telefondan o'chirilmaydi.

## 2. Pipeline arxitekturasi

```mermaid
flowchart LR
    A[S3 raw/<br/>left.mov, right.mov] --> B[1. Probe + normalize<br/>FFmpeg: CFR, timecode]
    B --> C[2. Sinxronlash<br/>audio cross-correlation]
    C --> D[3. Kalibrovka<br/>maydon chiziqlari → homography]
    D --> E[4. Detect + track<br/>to'p, o'yinchilar]
    E --> F[5. Jamoa + identity<br/>bib rangi, bib raqami OCR]
    F --> G[6. Event'lar<br/>possession modeli]
    G --> H[7. Reyting<br/>formula v1]
    G --> I[8. Render<br/>virtual kamera, 16:9 + 9:16]
    H --> J[(PostgreSQL<br/>player_match_stats, match_events)]
    I --> K[(S3 clips/ + CloudFront)]
    J --> L[Review navbati<br/>admin/host]
    L --> M[Nashr: push, feed, ulashish]
```

**Navbat va compute:**
- Core API'da BullMQ ishlatiladi, lekin u faqat Node.js uchun. Python GPU worker'lar uchun **SQS + AWS Batch** (spot GPU, ishsiz paytda 0 instance) tanlanadi. API job'ni `media_processing_jobs` ga yozadi va SQS'ga xabar yuboradi; holat har bosqichda shu jadvalda yangilanadi.
- Har bosqich alohida va qayta boshlanadigan (idempotent) bo'ladi. Bosqich natijalari S3'ga yoziladi: `work/{recording_id}/{stage}/…`. 6-bosqich xato bersa, detection qayta ishlanmaydi.
- GPU image: CUDA + ONNX Runtime yoki TensorRT, FFmpeg NVENC bilan. Instance: `g6.xlarge` (L4) yoki `g5.xlarge` (A10G), spot.
- Region: `eu-central-1` (§4.3). Yuzni tanish ishlatilmaydi, shuning uchun bu biometrik qayta ishlash emas (§8).

**"Stitching" haqida aniqlik.** Tahlil uchun 4K panorama shart emas. Har kamera o'z **homography**'si bilan maydon tekisligiga (metrlardagi 2D koordinatalar) proyeksiya qilinadi. Shu tufayli ikkala kameradagi detection'lar bitta koordinata tizimida birlashadi, progressiv pas kabi metrikalar esa metrda hisoblanadi.

Panorama (OpenCV: maydon chiziqlari bo'yicha moslash, ustma-ust qismda SIFT/ORB, seam blending) faqat **chiqish videosi** uchun yasaladi:
- to'liq o'yin replay'i (2×4K → ~5K panorama, keyin 1080p/1440p ga kichraytiriladi);
- kliplar uchun **virtual kamera** — to'p ortidan silliq yuruvchi crop (Veo/Trace kabi).

## 3. Computer vision modellari

| Vazifa | Yondashuv | Eslatma |
|---|---|---|
| O'yinchi va to'p detection | Fine-tune qilingan detector. Kandidatlar: **RT-DETR** yoki **YOLOX** (Apache-2.0) yoki YOLOv8/YOLO11 | ⚠️ Ultralytics YOLOv8/YOLO11 — **AGPL-3.0**, YOLOv10 ham shu kodga asoslangan. Yopiq kommersiya mahsulotida ishlatish uchun Ultralytics Enterprise litsenziyasi kerak, aks holda Apache-2.0 modellar olinadi. Tanlov pilot benchmark'idan keyin. |
| To'p (kichik obyekt) | Yuqori aniqlikdagi tile'lar (SAHI uslubi), to'pga alohida model, Kalman filtr + yo'qolgan kadrlarda interpolyatsiya | 4K'da to'p 10–20 px. Panjara (qafas maydonlar) va tungi yoritish asosiy xato manbalari. |
| Tracking | **ByteTrack** (MIT) yoki BoT-SORT; har kamera alohida, keyin pitch koordinatalarida birlashtiriladi | DeepSORT'ning tashqi ko'rinish embedding'lari faqat ishlov paytida, keyin o'chiriladi (§8). |
| Kalibrovka | Maydon chiziqlari va burchak keypoint modeli + RANSAC homography; kamera qimirlasa, har N soniyada qayta baholanadi | Maydon o'lchamlari `pitches.length_m/width_m` dan olinadi. |
| Jamoa | Tors crop'laridagi rang bo'yicha K-means. Bib ranglari oldindan ma'lum (`match_sides.bib_color`) | Hakam yoki tomoshabin — 3-klaster yoki maydondan tashqarida. |
| Identity | Bib raqami **OCR** (PARSeq/CRNN, bib raqamlariga fine-tune qilingan) + track bo'ylab ovoz berish → `match_participants.bib_number` | Aniqlanmagan track'lar review navbatiga tushadi va host/admin uni bir bosishda o'yinchiga bog'laydi. |

## 4. Event'lar va reyting

**Possession modeli:** har kadr uchun to'pga eng yaqin o'yinchi (≤ 1.5 m, pitch koordinatalarida) va to'p tezligi → possession segmentlari. Event'lar segmentlar orasidagi o'tishlardan chiqariladi:

| Event | Qoida (v1, kichik maydonlar uchun masshtablanadi) | `match_event_type` |
|---|---|---|
| Pas | possession bir jamoa ichida A → B o'tadi | `pass` |
| Progressiv pas | to'p raqib darvozasi tomon ≥ 25% qolgan masofaga yoki oxirgi uchdan birga o'tadi | `progressive_pass` |
| Key pas | pasdan keyin ≤ 3 s ichida zarba | `key_pass` |
| Muvaffaqiyatli dribling | olib yurish paytida ≤ 2 m'dagi raqib orqada qoladi va possession ≥ 1.5 s saqlanadi | `dribble_success` / `dribble_fail` |
| To'p yo'qotish | o'yinchi tekkandan keyin ≤ 2 s ichida possession raqibga o'tadi | `turnover` |
| Zarba | to'p tezligi keskin oshadi va darvoza sektoriga yo'naladi | `shot`, `shot_on_target` |
| Gol | to'p kalibrovkada belgilangan darvoza chizig'ini ustunlar orasidan kesib o'tadi | `goal` (bor) |

Gollar host kiritgan hisob bilan solishtiriladi: hisob mos kelmasa, match review'ga tushadi. Foul va kartochkalarni videodan ishonchli aniqlab bo'lmaydi — ular host'ning `incidents` ma'lumotidan olinadi.

**Reyting formulasi v1** (sozlanadigan, `rating_formulas` jadvalida versiyalangan):

```
rating = clamp(6.0 + Σ(weight[e] × confidence[e]) + team_result, 3.0, 10.0), 0.1 gacha yaxlitlanadi
```

| Event | Og'irlik | Event | Og'irlik |
|---|---|---|---|
| Gol | +1.2 | To'p yo'qotish | −0.2 |
| Assist | +0.8 | Muvaffaqiyatsiz dribling | −0.1 |
| Key pas | +0.5 | Avtogol | −1.0 |
| Muvaffaqiyatli dribling | +0.2 | Foul (host) | −0.4 |
| Progressiv pas | +0.15 | Sariq / qizil (host) | −0.5 / −1.5 |
| Darvozaga zarba | +0.2 | G'alaba / mag'lubiyat | +0.3 / −0.2 |

- O'yinchi kamroq o'ynagan bo'lsa (almashinuvlar), hissa o'ynagan daqiqalar bo'yicha normallashtiriladi.
- Har reyting bilan `rating_breakdown` (qaysi event qancha qo'shdi) saqlanadi. Shunda ilovada "Nega 7.8?" deb so'ralganda tushuntirish mumkin.
- Bu **o'yin reytingi** — matchmaking'dagi Glicko darajasidan (`player_sport_profiles.rating`) alohida. Keyinchalik unga past og'irlikdagi signal sifatida qo'shilishi mumkin.

**Overlay matnlari** lokalizatsiya qilinadi: "MUVAFFAQIYATLI DRIBLING" / "УСПЕШНЫЙ ДРИБЛИНГ" / "SUCCESSFUL DRIBBLE".

## 5. DB kengaytmasi — `0006_ai_cam.sql` (faqat additive)

| Jadval / o'zgarish | Asosiy ustunlar |
|---|---|
| `match_participants` + `bib_number smallint` | partial UNIQUE (match_id, bib_number) — host check-in'da biriktiradi |
| `recording_sessions` (yangi) | match_id UNIQUE, host_user_id, status (`recording → uploading → uploaded → processing → review → ready / failed / rejected`), rig_type, started_at, kickoff_offset_ms, panorama_media_id |
| `recording_cameras` (yangi) | session_id, position (`left`, `right`, `wide`), device_model, media_asset_id, fps, resolution, sync_offset_ms, calibration jsonb (homography, intrinsics, sifat), status |
| `media_processing_jobs` + `recording_session_id` (`stage` 0008 da qo'shilgan — `ADD COLUMN IF NOT EXISTS` bilan) | yangi enum qiymatlari: `ai_cam_sync`, `ai_cam_calibrate`, `ai_cam_track`, `ai_cam_events`, `ai_cam_rating`, `ai_cam_render` |
| `match_events` + ustunlar | yangi `match_event_type` qiymatlari (§4); `pitch_x/y`, `end_x/y`, `track_id`, `model_version` |
| `player_match_stats` (yangi) — so'ralgan `Player_Stats` | PK (match_id, participant_id), user_id, minutes_played, passes, passes_completed, progressive_passes, key_passes, dribbles_attempted/success, turnovers, shots, shots_on_target, goals, assists, distance_m, top_speed_kmh, sprints, **rating numeric(3,1)**, rating_breakdown jsonb, formula_version, model_version, status (`draft / published / disputed / withdrawn`), reviewed_by, published_at |
| `rating_formulas` (yangi) | version, weights jsonb, active_from — o'zgarishlar audit qilinadi |
| `highlights` + ustunlar — so'ralgan `Video_Clips` | clip_type (event turi), primary_participant_id, overlay jsonb (locale bo'yicha matn, badge), recording_session_id. Yangi `highlight_renditions` (highlight_id, aspect `16:9` / `9:16`, media_asset_id, branded) — Reels/Telegram uchun tayyor vertikal MP4 |

`Video_Clips` uchun alohida jadval ochilmaydi: mavjud `highlights` jadvali (moderatsiya, visibility, like'lar, teglar) kengaytiriladi. Shunda qo'lda va AI yaratgan kliplar bitta feed'da yuradi.

**Saqlash muddatlari (S3 lifecycle):**
- xom video — 30 kun;
- panorama replay — 90 kun;
- kliplar va renditions — highlight o'chirilguncha;
- `work/` oraliq fayllari — 7 kun.

## 6. API kontraktlari

| Method | Path | Kim | Vazifa |
|---|---|---|---|
| POST | `/v1/host/matches/{id}/recordings` | host | sessiya + kameralar, har kamera uchun multipart init |
| GET | `/v1/host/recordings/{id}/cameras/{cam}/parts` | host | yuklangan qismlar (davom ettirish uchun) va yangi presigned URL'lar |
| POST | `/v1/host/recordings/{id}/cameras/{cam}/complete` | host | ETag'lar + sha256 → kamera `uploaded`; hammasi tayyor bo'lsa pipeline navbatga |
| GET | `/v1/host/recordings/{id}` | host | upload/ishlov holati |
| GET | **`/v1/matches/{id}/analytics`** | o'yinchi (participant) | match statistikasi, mening reytingim + breakdown, kliplarim (overlay, renditions, share havolasi), badge'lar, top o'yinchilar (faqat roziligi borlar) |
| GET | `/v1/me/highlights` | o'yinchi | profil feed'i (cursor) |
| POST | `/v1/highlights/{id}/share` | o'yinchi | imzolangan qisqa havola + `HighlightShared` event (Instagram Reels, Telegram) |
| POST | `/v1/matches/{id}/analytics/disputes` | o'yinchi | "bu men emasman" / "reyting noto'g'ri" → review |
| GET/POST | `/v1/admin/ai/reviews`, `.../{id}/approve`, `.../tracks/{track}/assign` | admin | review navbati, aniqlanmagan track'ni o'yinchiga bog'lash, nashr |
| WS | `match:{id}` → `analytics.ready` | — | tayyor bo'lganda jonli xabar |

```json
GET /v1/matches/01a1…/analytics
{
  "status": "ready",
  "model_version": "aicam-2027.1",
  "score": [{ "side_no": 1, "label": "Oranges", "score": 5 }, { "side_no": 2, "label": "Blues", "score": 3 }],
  "me": {
    "participant_id": "01a1…", "bib_number": 7, "rating": 8.7,
    "rating_breakdown": [{ "event": "goal", "count": 2, "points": 2.4 }, { "event": "turnover", "count": 3, "points": -0.6 }],
    "stats": { "goals": 2, "assists": 1, "passes": 24, "progressive_passes": 6, "dribbles_success": 4, "distance_m": 4210 },
    "badges": [{ "code": "match_mvp", "label": "O'yin MVP'si" }]
  },
  "clips": [{
    "id": "01a1…", "clip_type": "dribble_success", "match_offset_ms": 1834000, "duration_ms": 9000,
    "overlay": { "text": "MUVAFFAQIYATLI DRIBLING", "rating_delta": "+0.2" },
    "renditions": [
      { "aspect": "9:16", "url": "https://cdn…/clips/…/v.mp4?Expires=…&Signature=…" },
      { "aspect": "16:9", "url": "https://cdn…/clips/…/h.m3u8?…" }
    ],
    "share_url": "https://mu.example/h/7Fk2Q"
  }],
  "top_players": [{ "display_name": "Jasur", "rating": 9.1, "bib_number": 10 }]
}
```

## 7. Infratuzilma va taxminiy xarajat

| Element | Taxmin (pilotda o'lchanadi) |
|---|---|
| Kadrlar soni | 2 kamera × 90 daq × 25 fps (sinov uchun 30 → 25) ≈ 270 000 kadr |
| GPU vaqti | detection + tracking ≈ 15–30 daq (L4, batch, TensorRT FP16), render ≈ 10 daq |
| GPU narxi | spot'da ≈ $0.3–1 / match |
| S3 | 30 GB xom × 30 kun ≈ $0.7 / match + panorama va kliplar |
| Tayyor bo'lish vaqti | upload tugagach ≤ 2 soat (maqsad) |

Natijalar API'ga ichki endpoint orqali yoziladi (servis token, faqat VPC ichida). Worker DB'ga to'g'ridan-to'g'ri yozmaydi — modul chegaralari saqlanadi (§4.2).

## 8. Maxfiylik va rozilik

- **Yuz tanish ishlatilmaydi.** O'yinchi bib raqami orqali tanib olinadi. Tashqi ko'rinish embedding'lari faqat bitta match ichida, ishlov paytida ishlatiladi va keyin o'chiriladi. Shuning uchun bu biometrik qayta ishlash emas deb hisoblanmoqda — ⚠️ buni yurist tasdiqlashi kerak (`ARCHITECTURE.md` §6). Agar kelajakda yuz yoki biometrik Re-ID kerak bo'lsa, uni faqat O'zbekiston ichida qayta ishlash mumkin (§4.3).
- `media_appearance` consent'i:
  - **bor** — o'yinchi kliplarda teglanadi, shaxsiy reyting oladi va top ro'yxatda ko'rinadi;
  - **yo'q** — statistika anonim (faqat jamoa darajasida), ochiq kliplarda yuzi xiralashtiriladi (`face_blur` job), u teglanmaydi.
- Voyaga yetmaganlar uchun guardian roziligi talab qilinadi; ularning reytingi ochiq top ro'yxatlarda ko'rsatilmaydi.
- O'chirish so'rovi (erasure): o'yinchining stats va teglari o'chiriladi, u bosh qahramon bo'lgan kliplar nashrdan olinadi.
- Ommaviy match'larda ham video **faqat ishtirokchilarga** ko'rinadi (`visibility = participants`). Ochiq qilish uchun klipdagi o'yinchining roziligi kerak.

## 9. Sifat va tekshirish

- **Dataset:** pilot match'lardan kadrlar CVAT'da belgilanadi (to'p, o'yinchilar, bib raqamlari, event'lar). Test set venue va kun vaqti (kunduz/tun) bo'yicha ajratiladi.
- **Maqsad metrikalar** (avtomatik nashrdan oldin):
  - gol detection precision ≥ 0.95, recall ≥ 0.9;
  - bib OCR aniqligi ≥ 0.9 (track darajasida);
  - tracking IDF1 ≥ 0.7;
  - event precision ≥ 0.8.
- **Shadow rejim:** dastlabki match'larda reyting faqat admin'ga ko'rinadi, o'yinchilarga ko'rsatilmaydi. Sifat maqsadga yetgach — "AI beta" belgisi bilan nashr, nizolar uchun tugma bilan.
- Har release'da formula va model versiyasi saqlanadi. Eski match'lar avtomatik qayta hisoblanmaydi.

## 10. Bosqichlar

| Bosqich | Ko'lam | Natija |
|---|---|---|
| **A — Yozish va ma'lumot yig'ish** | host app'da yozish rejimi va resumable upload, `recording_sessions`, bib biriktirish, to'liq o'yin videosi ishtirokchilarga, host qo'lda belgilagan highlight'lar | Dataset yig'iladi, rig operatsion jihatdan sinaladi |
| **B — Avtomatik kliplar** | sinxronlash, kalibrovka, detection va tracking, gol va zarba event'lari, virtual kamera render, 9:16 ulashish | "AI beta" gol kliplari |
| **C — O'yinchi statistikasi va reyting** | jamoa va bib identity, possession modeli, barcha event'lar, `player_match_stats`, formula v1, review navbati, `/analytics` | Reyting avval shadow rejimda, keyin nashr |
| **D — Optimallashtirish** | qurilmada oldindan ishlov (upload hajmini kamaytirish), venue'larga doimiy kameralar, deyarli real-time | Narx va kechikish pasayadi |

## 11. Xatarlar va ochiq savollar

| Xatar | Choralar |
|---|---|
| Ultralytics AGPL litsenziyasi | Apache-2.0 modellar (RT-DETR/YOLOX) yoki Enterprise litsenziya — Bosqich B oldidan qaror |
| Telefon qizishi va batareya (yoz) | power bank, soya, 4K o'rniga 2.7K varianti, harorat logi |
| Venue'larda Wi-Fi yo'q | resumable upload uydan ham davom etadi; Bosqich D'da qurilmada siqish |
| Qafas/panjara, tungi yoritish | venue bo'yicha kalibrovka profili, test set'da alohida o'lchash |
| Host'ga qo'shimcha ish (~10–15 daq rig) | host haqiga AI-Cam bonusi, rig bo'yicha qo'llanma |
| "Biometrik ma'lumot" ta'rifi | yuz tanimaslik siyosati, yurist xulosasi (ARCHITECTURE §6, 1-band) |
| Reyting adolati va nizolar | breakdown shaffofligi, nizo oqimi, shadow rejim |
