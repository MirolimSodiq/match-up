-- =============================================================================
-- Match Up — 0012: Admin'da host payout'larini to'lash
--
-- FAQAT ADDITIVE: yangi ustunlar, constraint va index.
--   * host_payouts.paid_by — "to'landi" deb belgilagan admin; note — izoh (masalan bank o'tkazmasi tafsiloti).
--     O'tkazma raqami — mavjud provider_ref ustunida (ommaviy belgilashda bir nechta payout'ga bitta raqam).
--   * paid holati o'tkazma raqami, vaqti va adminisiz bo'lmaydi.
--   * Admin ro'yxati: holat + davr bo'yicha (eng yangi hafta birinchi).
-- =============================================================================

BEGIN;

ALTER TABLE host_payouts
  ADD COLUMN paid_by uuid REFERENCES users(id),
  ADD COLUMN note    text,
  ADD CONSTRAINT host_payouts_paid_complete
    CHECK (status <> 'paid' OR (provider_ref IS NOT NULL AND paid_at IS NOT NULL AND paid_by IS NOT NULL));

CREATE INDEX host_payouts_status_period_idx ON host_payouts (status, period_start DESC);

COMMIT;
