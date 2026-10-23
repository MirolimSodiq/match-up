-- =============================================================================
-- Match Up — 0011: Provider refund'larini avtomatlashtirish
--
-- FAQAT ADDITIVE: yangi enum va ustunlar.
--   * refunds.auto_*  — `original_method` refund'ini provider API orqali qaytarish holati
--     (Payme Subscribe API `receipts.cancel`, Click Merchant API `payment/reversal`):
--       NULL       — hali ko'rilmagan (job oladi) yoki avtomatlashtirish tegishli emas (hamyon, yakunlangan);
--       queued     — navbatda: `auto_next_at` da (qayta) urinish;
--       submitted  — provider'ga yuborildi, natija kutilmoqda (Payme: chek "bekor qilish navbatida",
--                    CancelTransaction webhook'i yoki `receipts.check` yakunlaydi);
--       manual     — admin hal qiladi, sababi `manual_reason` da.
--   * manual_reason   — partial (provider faqat to'liq qaytaradi), unsupported (provider'da refund API yo'q),
--     disabled (provider uchun avto-refund o'chiq), rejected (provider rad etdi), failed (urinishlar tugadi),
--     timeout (provider natijani tasdiqlamadi), legacy (migratsiyadan oldingi navbat).
-- Navbatdagi refund'larni tanlash uchun 0003 dagi refunds_queue_idx yetarli (pending + original_method).
-- =============================================================================

BEGIN;

CREATE TYPE refund_auto_status AS ENUM ('queued', 'submitted', 'manual');

ALTER TABLE refunds
  ADD COLUMN auto_status       refund_auto_status,
  ADD COLUMN auto_attempts     smallint NOT NULL DEFAULT 0 CHECK (auto_attempts >= 0),
  ADD COLUMN auto_next_at      timestamptz,
  ADD COLUMN auto_submitted_at timestamptz,
  ADD COLUMN auto_error        text,
  ADD COLUMN manual_reason     text CHECK (manual_reason IN ('partial', 'unsupported', 'disabled', 'rejected', 'failed', 'timeout', 'legacy')),
  ADD CONSTRAINT refunds_manual_has_reason CHECK ((auto_status IS NOT DISTINCT FROM 'manual') = (manual_reason IS NOT NULL));

-- Migratsiyadan oldin navbatda turgan refund'lar provider kabinetida qo'lda bajarilgan bo'lishi mumkin:
-- ikki marta qaytarmaslik uchun ular avtomatik job'ga berilmaydi.
UPDATE refunds SET auto_status = 'manual', manual_reason = 'legacy'
 WHERE status = 'pending' AND destination = 'original_method';

COMMIT;
