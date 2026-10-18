-- =============================================================================
-- Atomik seat hold — oversell'ga qarshi asosiy mexanizm.
--
-- Bitta SQL statement: shartli UPDATE (row lock) -> booking -> roster.
-- READ COMMITTED'da parallel so'rovlar matches qatorida navbatga turadi, har biri
-- WHERE shartini yangi qiymat bilan qayta tekshiradi (EvalPlanQual) -> 14 joyli match'ga
-- 30 ta parallel so'rovdan aniq 14 tasi o'tadi (db/tests/verify.sh isbotlaydi).
-- 0 qator qaytsa -> API 409 MATCH_FULL / MATCH_CLOSED.
-- Unique index (match_id, user_id) buzilsa -> butun statement rollback -> 409 ALREADY_BOOKED.
--
-- psql: -v match_id=... -v user_id=... -v signature_id=... -v seats=1 -v idem=...
-- =============================================================================
WITH hold AS (
  UPDATE matches
     SET held_slots = held_slots + :seats
   WHERE id = :'match_id'::uuid
     AND status = 'open'
     AND now() < booking_closes_at
     AND held_slots + confirmed_slots + :seats <= max_players
  RETURNING id, price_amount, currency
), b AS (
  INSERT INTO bookings (user_id, match_id, seats, unit_price_amount, total_amount, currency,
                        waiver_signature_id, idempotency_key, expires_at)
  SELECT :'user_id'::uuid, hold.id, :seats, hold.price_amount, hold.price_amount * :seats, hold.currency,
         :'signature_id'::uuid, :'idem', now() + interval '15 minutes'
  FROM hold
  RETURNING id, match_id, user_id, total_amount, expires_at
)
INSERT INTO match_participants (match_id, booking_id, user_id, status, source)
SELECT match_id, id, user_id, 'held', 'booking' FROM b
RETURNING booking_id;
-- Mehmonlar (seats > 1) uchun qo'shimcha roster qatorlari: user_id = NULL, guest_name = '...'.
