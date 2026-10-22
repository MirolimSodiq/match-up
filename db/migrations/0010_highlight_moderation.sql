-- =============================================================================
-- Match Up — 0010: Highlight moderatsiyasi (admin panel)
--
-- FAQAT ADDITIVE: yangi ustunlar va index.
-- Model — post-moderatsiya: worker tayyorlagan klip darhol nashr qilinadi (`pending` ham ishtirokchilarga
-- ko'rinadi), admin navbatda ko'rib chiqadi; `rejected` hamma joyda yashiriladi (feed, ulashish havolasi,
-- push'lar), `approved` — ochiq feed'ga (`highlights_feed_idx`) kirish sharti.
--   * moderated_by / moderated_at — oxirgi qaror (to'liq tarix — audit_logs `highlight.moderate`).
--   * moderation_reason — rad etish sababi kodi (API tekshiradi), moderation_note — admin izohi.
-- =============================================================================

BEGIN;

ALTER TABLE highlights ADD COLUMN moderated_by      uuid REFERENCES users(id);
ALTER TABLE highlights ADD COLUMN moderated_at      timestamptz;
ALTER TABLE highlights ADD COLUMN moderation_reason text;
ALTER TABLE highlights ADD COLUMN moderation_note   text;

-- Admin navbati: nashr qilingan, o'chirilmagan kliplar holat bo'yicha
CREATE INDEX highlights_moderation_idx ON highlights (moderation_status, published_at)
  WHERE published_at IS NOT NULL AND deleted_at IS NULL;

COMMIT;
