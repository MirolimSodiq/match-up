-- =============================================================================
-- Match Up — 0006: AI-Cam Bosqich A — to'liq o'yinni yozish (docs/AI_CAM.md §5, §10)
--
-- FAQAT ADDITIVE: yangi jadvallar, nullable ustunlar, yangi index'lar.
--   * match_participants.bib_number — host check-in'da biriktiradi (Bosqich C'da o'yinchini tanish uchun).
--   * recording_sessions — match uchun bitta yozuv sessiyasi (rig, kick-off vaqti, holat).
--   * recording_cameras — har telefonning har yozuv fayli (pozitsiya, boshlanish vaqti, media_assets).
--   * recording_markers — host yozish paytida belgilagan lahzalar (highlight, kick-off); klip qaysi
--     kameradan kesilgani va yaratilgan highlight shu yerda.
--   * media_processing_jobs / highlights + recording_session_id.
--
-- Raqam 0007/0008 dan oldin: toza bazada 0006 ular qo'llanmasdan ishlaydi, shuning uchun faqat
-- 0001–0005 dagi obyektlarga tayanadi (0008 dagi `stage`, `context` va h.k. ishlatilmaydi).
-- Holatlar `text + CHECK` (enum emas): keyingi bosqichlar (review, AI) CHECK'ni almashtirib qo'shadi.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Bib raqami (oldi va orqasida katta raqamli manishka)
-- -----------------------------------------------------------------------------
ALTER TABLE match_participants ADD COLUMN bib_number smallint CHECK (bib_number BETWEEN 1 AND 99);
-- Bitta match'da bitta raqam — faqat faol roster qatorlari orasida (bekor qilingan joyning raqami bo'shaydi)
CREATE UNIQUE INDEX match_participants_bib_unique ON match_participants (match_id, bib_number)
  WHERE bib_number IS NOT NULL AND status IN ('held', 'confirmed', 'checked_in', 'no_show');

-- -----------------------------------------------------------------------------
-- Yozuv sessiyasi: match uchun bitta
-- -----------------------------------------------------------------------------
CREATE TABLE recording_sessions (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id       uuid NOT NULL UNIQUE REFERENCES matches(id),
  host_user_id   uuid NOT NULL REFERENCES users(id),        -- sessiyani ochgan host
  -- recording: kamida bitta kamera yozmoqda (yoki hali kamera yo'q); uploading: yozish tugadi, fayllar
  -- yuklanmoqda; processing: worker; ready: kamida bitta kamera tayyor, qolganlari tugagan; failed: hammasi xato
  status         text NOT NULL DEFAULT 'recording'
                 CHECK (status IN ('recording', 'uploading', 'processing', 'ready', 'failed')),
  rig_type       text NOT NULL DEFAULT 'two_phone' CHECK (rig_type IN ('single_phone', 'two_phone', 'three_phone')),
  kickoff_at     timestamptz,                               -- eng birinchi `kickoff` belgisi
  ready_at       timestamptz,                               -- birinchi marta `ready` (RecordingReady bir marta)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Kamera fayllari: har telefon (left / right / wide) bir yoki bir nechta fayl (qizib to'xtasa — yangi fayl)
-- -----------------------------------------------------------------------------
CREATE TABLE recording_cameras (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  session_id        uuid NOT NULL REFERENCES recording_sessions(id),
  -- Qurilma yaratadi: internet bo'lmasa ham yozish boshlanadi, ro'yxatga olish keyin (idempotent PUT)
  client_camera_id  uuid NOT NULL UNIQUE,
  position          text NOT NULL CHECK (position IN ('left', 'right', 'wide')),
  recorded_by       uuid NOT NULL REFERENCES users(id),
  device_model      text,
  status            text NOT NULL DEFAULT 'recording'
                    CHECK (status IN ('recording', 'recorded', 'uploading', 'processing', 'ready', 'failed', 'cancelled')),
  started_at        timestamptz NOT NULL,                   -- birinchi kadr (qurilma soati, NTP)
  stopped_at        timestamptz,
  duration_ms       integer CHECK (duration_ms >= 0),       -- qurilma e'lon qilgani; worker probe'dan keyin aniqlanadi
  fps               numeric(6,3) CHECK (fps > 0),
  width             integer CHECK (width > 0),
  height            integer CHECK (height > 0),
  media_asset_id    uuid UNIQUE REFERENCES media_assets(id),
  failure_code      text,
  sync_offset_ms    integer,                                -- Bosqich B: audio sinxronlash natijasi
  calibration       jsonb,                                  -- Bosqich B: homography, intrinsics, sifat
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_cameras_stop_after_start CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
CREATE INDEX recording_cameras_session_idx ON recording_cameras (session_id, started_at);

-- -----------------------------------------------------------------------------
-- Host belgilari: yozish paytida "Highlight!" (klip) va "Kick-off" (match_offset_ms hisobi)
-- -----------------------------------------------------------------------------
CREATE TABLE recording_markers (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  session_id        uuid NOT NULL REFERENCES recording_sessions(id),
  client_marker_id  uuid NOT NULL UNIQUE,                   -- offline navbat, takroriy yuborish xavfsiz
  kind              text NOT NULL CHECK (kind IN ('highlight', 'kickoff')),
  occurred_at       timestamptz NOT NULL,                   -- belgi qurilmasi soati (NTP)
  side              text CHECK (side IN ('left', 'right')), -- qaysi darvoza tomoni -> qaysi kamera
  participant_id    uuid REFERENCES match_participants(id), -- ixtiyoriy: kim (consent bo'lsa teglanadi)
  pre_ms            integer NOT NULL DEFAULT 12000 CHECK (pre_ms BETWEEN 0 AND 55000),
  post_ms           integer NOT NULL DEFAULT 3000  CHECK (post_ms BETWEEN 0 AND 30000),
  created_by        uuid NOT NULL REFERENCES users(id),
  camera_id         uuid REFERENCES recording_cameras(id),  -- klip shu kameradan kesildi
  highlight_id      uuid UNIQUE REFERENCES highlights(id),
  deleted_at        timestamptz,                            -- host "bekor qildi"
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_markers_clip_length CHECK (pre_ms + post_ms BETWEEN 3000 AND 60000)
);
CREATE INDEX recording_markers_session_idx ON recording_markers (session_id, occurred_at);
-- Klipi hali kesilmagan belgilar (kamera tayyor bo'lganda shu ro'yxatdan olinadi)
CREATE INDEX recording_markers_pending_idx ON recording_markers (session_id)
  WHERE kind = 'highlight' AND highlight_id IS NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Bog'lanishlar
-- -----------------------------------------------------------------------------
ALTER TABLE media_processing_jobs ADD COLUMN recording_session_id uuid REFERENCES recording_sessions(id);
CREATE INDEX media_processing_jobs_recording_idx ON media_processing_jobs (recording_session_id)
  WHERE recording_session_id IS NOT NULL;
ALTER TABLE highlights ADD COLUMN recording_session_id uuid REFERENCES recording_sessions(id);

COMMIT;
