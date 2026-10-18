-- =============================================================================
-- Hold sweeper: muddati o'tgan pending_payment booking'larni bekor qilib, joylarni qaytaradi.
-- BullMQ repeatable job (har 30 soniyada) yoki booking'ning o'z delayed job'i chaqiradi.
-- To'lov webhook'i bilan poyga xavfsiz: ikkalasi ham bookings qatorini "status =
-- 'pending_payment'" sharti bilan yangilaydi — faqat bittasi yutadi.
-- =============================================================================
WITH expired AS (
  UPDATE bookings
     SET status = 'expired'
   WHERE status = 'pending_payment' AND expires_at < now()
  RETURNING id, match_id, seats
), parts AS (
  UPDATE match_participants mp
     SET status = 'expired'
    FROM expired e
   WHERE mp.booking_id = e.id AND mp.status = 'held'
  RETURNING mp.id
), released AS (
  UPDATE matches m
     SET held_slots = m.held_slots - x.seats
    FROM (SELECT match_id, sum(seats)::smallint AS seats FROM expired GROUP BY match_id) x
   WHERE m.id = x.match_id
  RETURNING m.id
), o AS (
  -- SlotsReleased -> waitlist'dagi birinchi odamga xabar
  INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
  SELECT 'match', id, 'SlotsReleased', '{}'::jsonb FROM released
)
SELECT (SELECT count(*) FROM expired)  AS expired_bookings,
       (SELECT count(*) FROM released) AS matches_released;
