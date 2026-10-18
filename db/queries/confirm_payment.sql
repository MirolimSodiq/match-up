-- =============================================================================
-- To'lov muvaffaqiyatli -> booking confirmed. Webhook handler ichida, payment_events
-- inbox'ga yozilgandan keyin, BIR tranzaksiyada (outbox event ham shu tranzaksiyada).
--
-- booking_confirmed = 0 bo'lsa: hold muddati allaqachon o'tgan (sweeper ozod qilgan)
--   -> "late payment" yo'li: joy bo'lsa qayta hold + confirm, bo'lmasa avto-refund.
--   Payme/Click/Uzum'da bu holat kam: CheckPerformTransaction/Prepare bosqichida hold
--   qayta tekshiriladi va joy yo'q bo'lsa pul umuman yechilmaydi.
--
-- psql: -v payment_id=...
-- =============================================================================
WITH pay AS (
  UPDATE payments
     SET status = 'succeeded', succeeded_at = now()
   WHERE id = :'payment_id' AND status IN ('created', 'pending', 'authorized')
  RETURNING booking_id
), b AS (
  UPDATE bookings
     SET status = 'confirmed', confirmed_at = now(), expires_at = NULL
   WHERE id = (SELECT booking_id FROM pay) AND status = 'pending_payment'
  RETURNING id, match_id, user_id, seats
), p AS (
  UPDATE match_participants
     SET status = 'confirmed'
   WHERE booking_id IN (SELECT id FROM b) AND status = 'held'
  RETURNING id
), m AS (
  UPDATE matches
     SET held_slots      = matches.held_slots - b.seats,
         confirmed_slots = matches.confirmed_slots + b.seats,
         status = CASE WHEN matches.confirmed_slots + b.seats = matches.max_players
                       THEN 'full'::match_status ELSE matches.status END
    FROM b
   WHERE matches.id = b.match_id
  RETURNING matches.id, matches.status
), o AS (
  INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
  SELECT 'booking', b.id, 'BookingConfirmed',
         jsonb_build_object('match_id', b.match_id, 'user_id', b.user_id, 'seats', b.seats)
  FROM b
  UNION ALL
  -- MatchFull -> host dispatch job'i ishga tushadi
  SELECT 'match', m.id, 'MatchFull', '{}'::jsonb FROM m WHERE m.status = 'full'
  RETURNING event_type
)
SELECT (SELECT count(*) FROM pay) AS payment_updated,
       (SELECT count(*) FROM b)   AS booking_confirmed,
       (SELECT status FROM m)     AS match_status;
