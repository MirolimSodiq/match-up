-- =============================================================================
-- Match Up — 0003: Admin operatsiyalari
--
-- FAQAT ADDITIVE: nullable ustunlar, bitta CHECK va admin ro'yxatlari uchun index'lar.
--   * Refund navbati: original_method refund'lari qo'lda (Payme/Click kabinetida) bajariladi,
--     admin provider_refund_id va izoh bilan "bajarildi" deb belgilaydi.
--   * Host moderatsiyasi: suspend vaqti va sababi (dispatch faqat status = 'active' hostlarni oladi).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Refund navbati
-- -----------------------------------------------------------------------------
ALTER TABLE refunds ADD COLUMN note         text;
ALTER TABLE refunds ADD COLUMN processed_by uuid REFERENCES users(id);   -- refund'ni yakunlagan admin

-- Navbat: qo'lda bajariladigan refund'lar, eng eskisi birinchi
CREATE INDEX refunds_queue_idx   ON refunds (created_at) WHERE status = 'pending' AND destination = 'original_method';
CREATE INDEX refunds_payment_idx ON refunds (payment_id);

-- -----------------------------------------------------------------------------
-- Host moderatsiyasi
-- -----------------------------------------------------------------------------
ALTER TABLE host_profiles ADD COLUMN suspended_at     timestamptz;
ALTER TABLE host_profiles ADD COLUMN suspended_reason text;
ALTER TABLE host_profiles ADD CONSTRAINT host_profiles_suspension_consistent
  CHECK (status <> 'suspended' OR suspended_at IS NOT NULL);

-- -----------------------------------------------------------------------------
-- Admin ro'yxatlari va dashboard
-- -----------------------------------------------------------------------------
-- Match'lar jadvali: barcha statuslar (draft/cancelled ham) vaqt bo'yicha
CREATE INDEX matches_starts_at_idx ON matches (starts_at);
CREATE INDEX matches_pitch_idx     ON matches (pitch_id);
-- To'lovlar jadvali: eng yangisi birinchi
CREATE INDEX payments_created_idx  ON payments (created_at DESC);

COMMIT;
