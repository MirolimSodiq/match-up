-- =============================================================================
-- Host dispatch: match uchun eng mos 5 ta host (sport mos, travel radius ichida,
-- o'sha vaqtda boshqa match'da band emas, bu match'ga hali taklif qilinmagan).
-- Dispatch job ularga ketma-ket (yoki parallel, "birinchi accept yutadi") offer yuboradi.
--
-- psql: -v match_id=...
-- =============================================================================
SELECT hp.user_id,
       u.display_name,
       hp.has_kit,
       hp.rating_avg,
       round(ST_Distance(hp.base_location, m.location))::int AS distance_m
FROM matches m
JOIN host_profiles hp ON hp.status = 'active' AND hp.home_city_id = m.city_id
JOIN host_sports  hs ON hs.user_id = hp.user_id AND hs.sport_id = m.sport_id
JOIN users        u  ON u.id = hp.user_id
WHERE m.id = :'match_id'
  AND ST_DWithin(hp.base_location, m.location, hp.max_travel_km * 1000)
  AND NOT EXISTS (
        SELECT 1
        FROM host_assignments ha
        JOIN matches om ON om.id = ha.match_id
        WHERE ha.host_user_id = hp.user_id
          AND ha.status IN ('accepted', 'arrived')
          AND tstzrange(om.starts_at - interval '1 hour', om.ends_at + interval '1 hour')
              && tstzrange(m.starts_at, m.ends_at))
  AND NOT EXISTS (
        SELECT 1 FROM host_assignments ha
        WHERE ha.match_id = m.id AND ha.host_user_id = hp.user_id)
ORDER BY hp.has_kit DESC, distance_m, hp.rating_avg DESC NULLS LAST
LIMIT 5;
