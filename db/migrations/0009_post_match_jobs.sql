-- =============================================================================
-- Match Up — 0009: O'yindan keyingi job'lar (Glicko-2 reyting, feedback, host no-show alert, host payout)
--
-- FAQAT ADDITIVE: yangi ustunlar, jadval va index'lar.
--   * player_sport_profiles.rating_volatility — Glicko-2 σ (rating va rating_deviation 0001 da bor).
--   * player_rating_changes — har match bo'yicha reyting o'zgarishi: tarix va idempotentlik
--     (MatchCompleted event'i qayta yetkazilsa reyting ikki marta qo'llanmaydi).
--   * host_assignments.no_show_alerted_at — kick-off − 15 daq da host yetib kelmagani haqidagi
--     ops ogohlantirishi bir marta yuboriladi.
--   * Index'lar: haftalik payout (to'lanmagan bajarilgan tayinlovlar), host feedback reytingi.
-- =============================================================================

BEGIN;

ALTER TABLE player_sport_profiles
  ADD COLUMN rating_volatility numeric(8,6) NOT NULL DEFAULT 0.06 CHECK (rating_volatility > 0);

CREATE TABLE player_rating_changes (
  match_id        uuid     NOT NULL REFERENCES matches(id),
  user_id         uuid     NOT NULL REFERENCES users(id),
  sport_id        smallint NOT NULL REFERENCES sports(id),
  side_no         smallint NOT NULL,
  -- natija: g'alaba = 1, durang = 0.5, mag'lubiyat = 0 (bir nechta raqib jamoa bo'lsa — o'rtachasi)
  score           numeric(3,2) NOT NULL CHECK (score BETWEEN 0 AND 1),
  rating_before   numeric(7,2) NOT NULL,
  rd_before       numeric(6,2) NOT NULL,
  vol_before      numeric(8,6) NOT NULL,
  rating_after    numeric(7,2) NOT NULL,
  rd_after        numeric(6,2) NOT NULL,
  vol_after       numeric(8,6) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX player_rating_changes_user_idx ON player_rating_changes (user_id, sport_id, created_at DESC);

ALTER TABLE host_assignments ADD COLUMN no_show_alerted_at timestamptz;

-- Haftalik payout: hali payout'ga kiritilmagan bajarilgan tayinlovlar
CREATE INDEX host_assignments_unpaid_idx ON host_assignments (host_user_id, completed_at)
  WHERE status = 'completed' AND payout_id IS NULL;

-- Host reytingi = host haqidagi barcha feedback'larning o'rtachasi
CREATE INDEX match_feedback_to_user_idx ON match_feedback (to_user_id, target) WHERE to_user_id IS NOT NULL;

COMMIT;
