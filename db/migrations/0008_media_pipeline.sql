-- =============================================================================
-- Match Up — 0008: Highlight video pipeline (yuklash -> qayta ishlash -> feed)
--
-- FAQAT ADDITIVE: nullable ustunlar, default'li ustunlar, yangi index'lar.
--   * media_assets: yuklash konteksti (qaysi match, teglar — highlight `complete` da yaratiladi),
--     multipart sessiya muddati, worker natijalari (HLS rendition'lar, 9:16 MP4, xato kodi).
--   * media_processing_jobs: navbat transporti (hozir Redis Stream, AI-Cam uchun SQS), yuborilgan
--     xabar id'si, joriy bosqich va heartbeat — API holatni shu jadvalda yuritadi, worker DB'ga yozmaydi.
--   * highlight_shares: imzolangan ochiq havola muddati.
--
-- Raqamlar: 0006 — AI-Cam (docs/AI_CAM.md §5), 0007 — Uzum. `stage` ustuni AI-Cam rejasida ham bor,
-- shuning uchun IF NOT EXISTS (0006 avval qo'llangan bazada ham xatosiz).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- media_assets
-- -----------------------------------------------------------------------------
-- Yuklash konteksti: {"kind": "highlight", "match_id": "…", "title": "…", "tagged_user_ids": ["…"],
-- "match_offset_ms": 1834000}. Highlight qatori faqat yuklash yakunlanganda (`complete`) yaratiladi.
ALTER TABLE media_assets ADD COLUMN context            jsonb;
ALTER TABLE media_assets ADD COLUMN upload_part_size   integer CHECK (upload_part_size > 0);
ALTER TABLE media_assets ADD COLUMN upload_expires_at  timestamptz;   -- shundan keyin multipart abort qilinadi
ALTER TABLE media_assets ADD COLUMN uploaded_at        timestamptz;   -- CompleteMultipartUpload vaqti
-- Worker natijalari (`bucket`/`object_key` — xom fayl, `playback_path` — HLS master, `thumbnail_key`)
ALTER TABLE media_assets ADD COLUMN output_bucket      text;
-- [{"name": "720p", "width": 720, "height": 1280, "bandwidth": 2500000, "playlist_key": "…/hls/720p/index.m3u8"}]
ALTER TABLE media_assets ADD COLUMN renditions         jsonb;
ALTER TABLE media_assets ADD COLUMN vertical_key       text;          -- 9:16 MP4 (Reels/Telegram)
ALTER TABLE media_assets ADD COLUMN processed_at       timestamptz;
ALTER TABLE media_assets ADD COLUMN failure_code       text;          -- DURATION_TOO_LONG, NOT_A_VIDEO, CHECKSUM_MISMATCH ...

-- Muddati o'tgan tugallanmagan yuklashlarni tozalash job'i
CREATE INDEX media_assets_upload_expiry_idx ON media_assets (upload_expires_at) WHERE status = 'uploading';

-- -----------------------------------------------------------------------------
-- media_processing_jobs
-- -----------------------------------------------------------------------------
ALTER TABLE media_processing_jobs ADD COLUMN IF NOT EXISTS stage text;   -- probe | validate | hls | thumbnail | vertical | upload
ALTER TABLE media_processing_jobs ADD COLUMN transport     text NOT NULL DEFAULT 'redis_stream'
  CHECK (transport IN ('redis_stream', 'sqs'));
ALTER TABLE media_processing_jobs ADD COLUMN message_id    text;          -- Redis Stream entry id / SQS MessageId
ALTER TABLE media_processing_jobs ADD COLUMN dispatched_at timestamptz;   -- navbatga yozilgan vaqt (NULL — hali yuborilmagan)
ALTER TABLE media_processing_jobs ADD COLUMN heartbeat_at  timestamptz;   -- worker oxirgi marta bosqich xabar qilgan vaqt

-- Bitta asset uchun bir turdagi faol job faqat bitta (takroriy `complete` poygasi)
CREATE UNIQUE INDEX media_processing_jobs_one_active ON media_processing_jobs (media_asset_id, type)
  WHERE status IN ('queued', 'running');
-- Navbatga yozilmay qolgan job'lar (Redis vaqtincha ishlamagan) — housekeeping qayta yuboradi
CREATE INDEX media_processing_jobs_undispatched_idx ON media_processing_jobs (queued_at)
  WHERE status = 'queued' AND dispatched_at IS NULL;

-- -----------------------------------------------------------------------------
-- highlights / highlight_shares
-- -----------------------------------------------------------------------------
-- Match sahifasidagi feed (ishtirokchilar uchun): nashr qilingan, o'chirilmagan
CREATE INDEX highlights_match_feed_idx ON highlights (match_id, published_at DESC, id DESC)
  WHERE published_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE highlight_shares ADD COLUMN expires_at timestamptz;   -- imzolangan ochiq havola muddati

COMMIT;
