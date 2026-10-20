-- =============================================================================
-- Match Up — 0004: Push xabarnomalar
--
-- FAQAT ADDITIVE: yangi ustunlar (default/nullable), bitta yangi jadval va index'lar.
--   * notifications: idempotentlik kaliti (outbox event id / eslatma turi), kategoriya
--     (transactional | marketing), qayta urinish holati.
--   * device_tokens: push provayderi (expo | fcm | apns) va o'chirilish sababi.
--   * push_deliveries: har bir qurilmaga yetkazish — provider ticket'i va receipt natijasi.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- notifications: idempotentlik va qayta urinish
-- -----------------------------------------------------------------------------
-- 'evt:<outbox_event_id>:<type>:<user_id>' | 'reminder_24h:<booking_id>' — bitta xabar bir marta yaratiladi
ALTER TABLE notifications ADD COLUMN dedupe_key      text;
ALTER TABLE notifications ADD COLUMN category        text NOT NULL DEFAULT 'transactional';
ALTER TABLE notifications ADD COLUMN attempts        smallint NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('transactional', 'marketing'));

CREATE UNIQUE INDEX notifications_dedupe_key_idx ON notifications (dedupe_key);
-- Qayta urinish navbati: yetkazilmagan push'lar
CREATE INDEX notifications_retry_idx  ON notifications (next_attempt_at) WHERE status = 'queued';
-- O'qilmaganlar soni (badge)
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- device_tokens: provayder
-- -----------------------------------------------------------------------------
ALTER TABLE device_tokens ADD COLUMN provider        text NOT NULL DEFAULT 'expo';
ALTER TABLE device_tokens ADD COLUMN disabled_reason text;   -- 'DeviceNotRegistered' | ...
ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_provider_check
  CHECK (provider IN ('expo', 'fcm', 'apns'));

-- -----------------------------------------------------------------------------
-- push_deliveries: notification x qurilma
-- -----------------------------------------------------------------------------
CREATE TABLE push_deliveries (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  notification_id     uuid NOT NULL REFERENCES notifications(id),
  -- Token o'chirilsa (logout, GDPR erasure) yetkazish tarixi ham o'chadi
  device_token_id     uuid NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  ticket_id           text,                 -- Expo ticket id / FCM message name
  status              text NOT NULL,
  error               text,                 -- 'DeviceNotRegistered', 'MessageTooBig', ...
  created_at          timestamptz NOT NULL DEFAULT now(),
  receipt_checked_at  timestamptz,
  CONSTRAINT push_deliveries_status_check CHECK (status IN ('sent', 'delivered', 'failed'))
);
CREATE INDEX push_deliveries_notification_idx ON push_deliveries (notification_id);
CREATE INDEX push_deliveries_device_idx       ON push_deliveries (device_token_id);
-- Receipt tekshiruvi navbati
CREATE INDEX push_deliveries_receipt_idx      ON push_deliveries (created_at)
  WHERE status = 'sent' AND ticket_id IS NOT NULL AND receipt_checked_at IS NULL;

-- -----------------------------------------------------------------------------
-- Kutish ro'yxati takliflari muddati (10 daqiqalik eksklyuziv oyna)
-- -----------------------------------------------------------------------------
CREATE INDEX match_waitlist_offer_expiry_idx ON match_waitlist (offer_expires_at) WHERE status = 'notified';

COMMIT;
