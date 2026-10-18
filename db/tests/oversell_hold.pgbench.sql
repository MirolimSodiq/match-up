-- pgbench -c 30 -t 1: har client boshqa player (client_id 0..29 -> +998902000001..30)
-- sifatida MU-RACE (max 14) match'ida bitta joyni bir vaqtda hold qilishga urinadi.
-- Kutilgan natija: aniq bo'sh joylar soni qadar booking, ortiqchasi 0 qator (MATCH_FULL).
WITH usr AS (
  SELECT u.id AS user_id, ws.id AS signature_id
  FROM users u
  JOIN waiver_signatures ws ON ws.user_id = u.id
  WHERE u.phone_e164 = '+99890200' || lpad((:client_id + 1)::text, 4, '0')
  LIMIT 1
), hold AS (
  UPDATE matches
     SET held_slots = held_slots + 1
   WHERE public_code = 'MU-RACE'
     AND status = 'open'
     AND now() < booking_closes_at
     AND held_slots + confirmed_slots + 1 <= max_players
     AND EXISTS (SELECT 1 FROM usr)
     AND NOT EXISTS (SELECT 1 FROM match_participants mp JOIN usr ON mp.user_id = usr.user_id
                     WHERE mp.match_id = matches.id AND mp.status IN ('held', 'confirmed'))
  RETURNING id, price_amount, currency
), b AS (
  INSERT INTO bookings (user_id, match_id, seats, unit_price_amount, total_amount, currency,
                        waiver_signature_id, idempotency_key, expires_at)
  SELECT usr.user_id, hold.id, 1, hold.price_amount, hold.price_amount, hold.currency,
         usr.signature_id, 'race-' || :client_id || '-' || clock_timestamp(), now() + interval '15 minutes'
  FROM hold, usr
  RETURNING id, match_id, user_id
)
INSERT INTO match_participants (match_id, booking_id, user_id, status, source)
SELECT match_id, id, user_id, 'held', 'booking' FROM b;
