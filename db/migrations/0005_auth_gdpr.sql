-- =============================================================================
-- Match Up — 0005: Social login va GDPR so'rovlari (DSR) job'lari
--
-- FAQAT ADDITIVE: nullable ustunlar, yangi index'lar va enum qiymati.
--   * auth_identities: foydalanuvchiga ko'rsatiladigan belgi (Google/Apple email, Telegram @username)
--     va "har provider'dan bitta identity" qoidasi. Email bo'yicha avtomatik bog'lash YO'Q —
--     identity faqat (provider, provider_uid) bo'yicha topiladi.
--   * data_subject_requests: eksport fayli (hozircha lokal storage, keyin S3), muddat,
--     erasure bloklanish sabablari va foydalanuvchi bekor qilgan vaqt.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Social identity
-- -----------------------------------------------------------------------------
ALTER TABLE auth_identities ADD COLUMN display_label text;   -- PII: erasure'da identity bilan birga o'chadi

-- Bitta user har provider'dan faqat bitta identity bog'laydi (ikkinchi Google akkaunt — 409)
CREATE UNIQUE INDEX auth_identities_user_provider_key ON auth_identities (user_id, provider);

-- -----------------------------------------------------------------------------
-- DSR: eksport fayli va erasure holati
-- -----------------------------------------------------------------------------
ALTER TABLE data_subject_requests ADD COLUMN export_path       text;          -- storage ichidagi nisbiy yo'l
ALTER TABLE data_subject_requests ADD COLUMN export_sha256     bytea;
ALTER TABLE data_subject_requests ADD COLUMN export_size_bytes bigint CHECK (export_size_bytes >= 0);
ALTER TABLE data_subject_requests ADD COLUMN export_expires_at timestamptz;   -- yuklab olish havolasi muddati
-- Erasure bajarilmadi: [{"code": "wallet_balance", ...}, {"code": "active_host_assignment", ...}]
ALTER TABLE data_subject_requests ADD COLUMN blocked_reasons   jsonb;
ALTER TABLE data_subject_requests ADD COLUMN blocked_at        timestamptz;
ALTER TABLE data_subject_requests ADD COLUMN cancelled_at      timestamptz;   -- grace davrida foydalanuvchi bekor qildi

-- Bir user'da bir vaqtda faqat bitta ochiq erasure so'rovi (parallel DELETE /v1/me poygasi)
CREATE UNIQUE INDEX dsr_one_open_erasure ON data_subject_requests (user_id)
  WHERE type = 'erasure' AND status IN ('received', 'in_progress');
-- Muddati o'tgan eksport fayllarini tozalash
CREATE INDEX dsr_export_expiry_idx ON data_subject_requests (export_expires_at) WHERE export_path IS NOT NULL;
CREATE INDEX dsr_user_idx ON data_subject_requests (user_id, requested_at DESC);

COMMIT;

-- ALTER TYPE ... ADD VALUE yangi qiymat ishlatilishidan oldin commit qilinishi kerak
-- migrate:split
ALTER TYPE dsr_status ADD VALUE IF NOT EXISTS 'cancelled';
