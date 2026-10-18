-- =============================================================================
-- Discovery: radius ichidagi ochiq match'lar (sport, sana, bo'sh joy, narx filtri).
-- Index: matches_discovery_gix — GiST (location, starts_at), partial (open/full + public).
--
-- psql:  -v lat=41.2995 -v lng=69.2401 -v radius_m=15000 -v sports=football,basketball
--        -v date_from=2026-10-18T00:00:00+05 -v date_to=2026-10-25T00:00:00+05
--        -v min_slots=1 -v page_size=20
-- App'da (Drizzle / pg): :var o'rniga $1..$n parametrlar.
-- Keyingi sahifa: keyset cursor = oxirgi qatorning (starts_at, id) — OFFSET ishlatilmaydi.
-- =============================================================================
SELECT m.id,
       m.public_code,
       s.code                                                 AS sport,
       m.format,
       m.starts_at,
       to_char(m.starts_at AT TIME ZONE v.timezone, 'YYYY-MM-DD HH24:MI') AS starts_local,
       m.max_players - m.held_slots - m.confirmed_slots       AS available_slots,
       m.max_players,
       m.price_amount,
       m.currency,
       v.name                                                 AS venue,
       round(ST_Distance(m.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography))::int AS distance_m
FROM matches m
JOIN sports  s ON s.id = m.sport_id
JOIN pitches p ON p.id = m.pitch_id
JOIN venues  v ON v.id = p.venue_id
WHERE m.status IN ('open', 'full')
  AND m.visibility = 'public'
  AND ST_DWithin(m.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius_m)
  AND m.starts_at >= :'date_from'::timestamptz
  AND m.starts_at <  :'date_to'::timestamptz
  AND s.code = ANY (string_to_array(:'sports', ','))
  AND m.max_players - m.held_slots - m.confirmed_slots >= :min_slots
  -- keyset: AND (m.starts_at, m.id) > (:'cursor_ts'::timestamptz, :'cursor_id'::uuid)
ORDER BY m.starts_at, m.id
LIMIT :page_size;
