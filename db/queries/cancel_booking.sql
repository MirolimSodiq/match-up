-- =============================================================================
-- O'yinchi confirmed booking'ni bekor qiladi -> joy qaytadi, full match yana open bo'ladi.
-- Refund summasi va yo'nalishi (original/wallet) app'da cancellation_policies.rules
-- bo'yicha hisoblanadi va BookingCancelled event'idan keyin refunds jadvaliga yoziladi.
--
-- psql: -v booking_id=... -v reason=user_cancel
-- =============================================================================
WITH b AS (
  UPDATE bookings
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = user_id, cancel_reason = :'reason'
   WHERE id = :'booking_id' AND status = 'confirmed'
  RETURNING id, match_id, seats
), p AS (
  UPDATE match_participants
     SET status = 'cancelled'
   WHERE booking_id IN (SELECT id FROM b) AND status = 'confirmed'
  RETURNING id
), m AS (
  UPDATE matches
     SET confirmed_slots = matches.confirmed_slots - b.seats,
         status = CASE WHEN matches.status = 'full' THEN 'open'::match_status ELSE matches.status END
    FROM b
   WHERE matches.id = b.match_id AND matches.starts_at > now()
  RETURNING matches.id, matches.status
), o AS (
  INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
  SELECT 'booking', b.id, 'BookingCancelled', jsonb_build_object('match_id', b.match_id, 'seats', b.seats)
  FROM b
)
SELECT (SELECT count(*) FROM b) AS cancelled, (SELECT status FROM m) AS match_status;
