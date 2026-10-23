# Match Up media worker

Host yozgan highlight kliplarini qayta ishlaydi: **probe → validatsiya → HLS (720p, 480p) → thumbnail → 9:16 MP4**.
AI-Cam (`docs/AI_CAM.md`) shu servis ustiga quriladi — navbat, storage va API qatlamlari qayta ishlatiladi.

| Profil (`start` javobida) | Bosqichlar | Lane (stream) |
|---|---|---|
| `highlight_v1` — host klipi (≤ 60 s) | download → probe → validate → hls (720p/480p) → thumbnail → vertical → upload | `matchup:media-jobs` |
| `recording_v1` — to'liq o'yin (AI-Cam A, ≤ 3 soat, ≤ 40 GB) | download → probe → validate → hls (1080p/720p/480p **bitta o'tishda**, segment nomi 5 xonali) → thumbnail (60-soniya) → upload | `matchup:media-jobs:recording` |
| `clip_v1` — host belgisidan klip | cut (yozuv playlist'i → faqat kerakli segmentlar → ulash → aniq kesish, `source.mp4`) → keyin `highlight_v1` bilan bir xil | `matchup:media-jobs` |

Bitta jarayon bitta stream'ni o'qiydi (`MEDIA_JOBS_STREAM`): prod'da ikki ECS servis (`media-worker`, `media-worker-recording`), lokal — ikki jarayon (pastda).

```
Redis Stream matchup:media-jobs (consumer group media-worker)
   │  {v, job_id, type, media_id}
   ▼
POST /internal/media/jobs/{id}/start  ──► job tafsilotlari (source bucket/key, output prefix, cheklovlar)
   │
   ├─ download (sha256 tekshiruvi) ─ probe ─ validate ─ hls ─ thumbnail ─ vertical ─ upload ─ manifest.json
   │        har bosqichda: POST .../progress {stage}  (heartbeat) + XCLAIM (lease uzaytiriladi)
   ▼
POST /internal/media/jobs/{id}/result  {status: ready, output} | {status: failed, error_code}
```

Worker DB'ga yozmaydi — holatni API `media_processing_jobs` da yuritadi va `HighlightReady` outbox event'ini chiqaradi.

## Ishonchlilik

| Holat | Xatti-harakat |
|---|---|
| Validatsiya xatosi (`DURATION_TOO_LONG`, `NOT_A_VIDEO`, `UNSUPPORTED_FORMAT`, `CHECKSUM_MISMATCH` ...) | darhol `failed`, xabar ACK |
| Vaqtinchalik xato (S3, API 5xx, FFmpeg signal/timeout) | ichki retry (backoff); bo'lmasa xabar ACK qilinmaydi va `CLAIM_IDLE_MS` dan keyin boshqa consumer oladi |
| Worker o'ldi | xabar pending'da qoladi → `XPENDING IDLE` + `XCLAIM` bilan qayta olinadi (`deliveries + 1`) |
| Scale-in / deploy (yozuv lane'i) | job paytida task himoyalangan — ECS uni to'xtatmaydi; himoya xatosi job'ni to'xtatmaydi (faqat ogohlantirish) |
| `MAX_DELIVERIES` (5) dan oshdi | `matchup:media-jobs:dead` ga yoziladi, job `failed` (`MAX_RETRIES_EXCEEDED`) |
| Job allaqachon tugagan / bekor qilingan (API 409/404) | ACK, ishlov yo'q |
| Takroriy yetkazish | bosqichlar `.done-<stage>` belgilari bilan o'tkazib yuboriladi; boshqa worker `manifest.json` dan natijani qayta yuboradi (qayta kodlamasdan) |

API tomonida housekeeping (har 30 s): navbatga yozilmay qolgan job'lar qayta yuboriladi, heartbeat'i 10 daqiqa to'xtagan job qayta navbatga qo'yiladi (5 urinishdan keyin `WORKER_TIMEOUT`).

## Natija (`highlights/{match_id}/{media_id}/`)

| Kalit | |
|---|---|
| `hls/master.m3u8`, `hls/{720p,480p}/index.m3u8`, `seg_NNN.ts` | H.264 Main + AAC, segment ~4 s, keyframe har 2 s, upscale yo'q |
| `thumb.jpg` | 1-soniya (yoki o'rtasi) kadri, qisqa tomon 720 |
| `vertical.mp4` | 720x1280, markazdan 9:16 crop, `+faststart` (Reels / Telegram) |
| `manifest.json` | profil, worker versiyasi, natija (idempotent qayta urinish uchun) |

Ijro: API playlist'larni imzolangan segment URL'lari bilan qayta yozadi (`/v1/playback/{token}/master.m3u8`) — segmentlar to'g'ridan-to'g'ri CloudFront/S3'dan.

## Ishga tushirish

```bash
uv sync
```

```bash
uv run pytest -q
```

Lokal (API `PORT=3002`, `docker compose up -d minio minio-init`):

```bash
REDIS_URL=redis://localhost:6379/4 API_INTERNAL_URL=http://localhost:3002 MEDIA_WORKER_TOKEN=dev-media-worker-token-0123456789abcdef S3_ENDPOINT=http://localhost:9000 S3_REGION=us-east-1 S3_ACCESS_KEY_ID=matchup S3_SECRET_ACCESS_KEY=matchup_dev_only S3_FORCE_PATH_STYLE=true uv run python -m media_worker
```

To'liq o'yin yozuvlari (AI-Cam) uchun ikkinchi jarayon — xuddi shu buyruq `MEDIA_JOBS_STREAM=matchup:media-jobs:recording WORK_DIR=/tmp/media-worker-recording` bilan.

| Env | Standart | |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379/4` | |
| `MEDIA_JOBS_STREAM` / `MEDIA_JOBS_GROUP` | `matchup:media-jobs` / `media-worker` | dead-letter: `<stream>:dead`; yozuv lane'i — `matchup:media-jobs:recording` |
| `API_INTERNAL_URL`, `MEDIA_WORKER_TOKEN` | `http://localhost:3002`, — | token API'niki bilan bir xil (≥ 32 belgi) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | AWS default chain | MinIO uchun endpoint + path style |
| `WORK_DIR` | `/tmp/media-worker` | ish papkasi va heartbeat |
| `MAX_DELIVERIES`, `CLAIM_IDLE_MS` | `5`, `120000` | |
| `FFMPEG_PRESET`, `FFMPEG_THREADS` | `veryfast`, `0` | |
| `ECS_TASK_PROTECTION`, `ECS_TASK_PROTECTION_MINUTES` | `false`, `60` | job paytida ECS task scale-in protection (yozuv lane'i): `$ECS_AGENT_URI/task-protection/v1/state`, keepalive'da har 15 daqiqada yangilanadi, job tugagach o'chiriladi. `ECS_AGENT_URI` ni ECS beradi |

## Keyingi qadamlar (AI-Cam)

- `JobSource` interfeysi (`queue.py`) — `SqsSource` (receive / ChangeMessageVisibility / DeleteMessage) qo'shiladi; API tomonida `MediaJobQueue` + `JOB_ROUTES` (`ai_*` → `sqs`).
- GPU worker alohida image (CUDA, ONNX Runtime) — shu `Pipeline`/`Api`/`Storage` qatlamlari bilan.
