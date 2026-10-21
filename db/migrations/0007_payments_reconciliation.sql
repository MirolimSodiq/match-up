-- =============================================================================
-- Match Up — 0007: To'lovlarni provider ma'lumoti bilan solishtirish (reconciliation)
--
-- FAQAT ADDITIVE: yangi enum'lar, jadvallar va index'lar.
--   * reconciliation_runs  — bitta provider + davr bo'yicha solishtirish (har kecha yoki admin qo'lda).
--   * reconciliation_items — topilgan farqlar: bizda bor / providerda yo'q, providerda bor / bizda yo'q,
--     summa farqi, holat farqi. Har bir farq audit_logs va outbox'ga ham yoziladi (kod tomonida).
-- Uzum Bank Merchant API uchun yangi ustun kerak emas: holat payments.provider_state'da
-- ({"state": "CREATED|CONFIRMED|REVERSED|FAILED", "trans_time": .., "confirm_time": .., ...}).
-- =============================================================================

BEGIN;

CREATE TYPE reconciliation_run_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE reconciliation_diff_kind  AS ENUM ('missing_at_provider', 'missing_locally', 'amount_mismatch', 'status_mismatch');

CREATE TABLE reconciliation_runs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  provider        payment_provider NOT NULL,
  period_from     timestamptz NOT NULL,
  period_to       timestamptz NOT NULL,
  status          reconciliation_run_status NOT NULL DEFAULT 'running',
  trigger         text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  triggered_by    uuid REFERENCES users(id),             -- manual: admin; schedule: NULL
  local_count     integer NOT NULL DEFAULT 0 CHECK (local_count >= 0),
  provider_count  integer NOT NULL DEFAULT 0 CHECK (provider_count >= 0),
  matched_count   integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  diff_count      integer NOT NULL DEFAULT 0 CHECK (diff_count >= 0),
  error           text,                                  -- status = failed: provider API xatosi
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  CONSTRAINT reconciliation_runs_period CHECK (period_from < period_to),
  CONSTRAINT reconciliation_runs_manual_actor CHECK (trigger = 'schedule' OR triggered_by IS NOT NULL)
);
CREATE INDEX reconciliation_runs_started_idx  ON reconciliation_runs (started_at DESC);
CREATE INDEX reconciliation_runs_provider_idx ON reconciliation_runs (provider, period_from DESC);
-- Bir provider va davr uchun bir vaqtda faqat bitta ishlayotgan solishtirish (kechki job + admin poygasi)
CREATE UNIQUE INDEX reconciliation_runs_one_running ON reconciliation_runs (provider, period_from, period_to)
  WHERE status = 'running';

CREATE TABLE reconciliation_items (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  run_id                   uuid NOT NULL REFERENCES reconciliation_runs(id),
  kind                     reconciliation_diff_kind NOT NULL,
  payment_id               uuid REFERENCES payments(id),   -- missing_locally: NULL
  provider_transaction_id  text,
  booking_id               uuid,                           -- provider account'idan (FK emas: provider noto'g'ri id yuborishi mumkin)
  currency                 char(3) REFERENCES currencies(code),
  local_amount             bigint,
  provider_amount          bigint,
  local_status             text,                           -- payments.status
  provider_status          text,                           -- normalizatsiya: succeeded | cancelled | refunded | pending
  details                  jsonb NOT NULL DEFAULT '{}',    -- provider'ning xom holati (masalan, Payme receipt state)
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_items_ref CHECK (payment_id IS NOT NULL OR provider_transaction_id IS NOT NULL)
);
CREATE INDEX reconciliation_items_run_idx     ON reconciliation_items (run_id, created_at);
CREATE INDEX reconciliation_items_payment_idx ON reconciliation_items (payment_id) WHERE payment_id IS NOT NULL;

COMMIT;
