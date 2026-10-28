-- =============================================================================
-- Match Up — dev seed: Toshkent + Samarqand, demo venue'lar, 30 player, 1 host.
-- Vaqtlar now() ga nisbatan -> seed har doim kelajakdagi match'lar bilan ishlaydi.
-- Barcha nomlar va telefon raqamlar uydirma (test uchun).
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- Reference
-- -----------------------------------------------------------------------------
INSERT INTO currencies (code, minor_unit, symbol, name) VALUES
  ('UZS', 2, 'so''m', '{"uz-Latn": "O''zbek so''mi", "ru": "Узбекский сум", "en": "Uzbekistani som"}'),
  ('USD', 2, '$',     '{"en": "US Dollar"}'),
  ('EUR', 2, '€',     '{"en": "Euro"}'),
  ('KZT', 2, '₸',     '{"en": "Kazakhstani tenge"}'),
  ('AED', 2, 'AED',   '{"en": "UAE Dirham"}');

INSERT INTO countries (code, name, default_currency, default_locale, phone_prefix, data_region, is_active) VALUES
  ('UZ', '{"uz-Latn": "O''zbekiston", "ru": "Узбекистан", "en": "Uzbekistan"}', 'UZS', 'uz-Latn', '+998', 'uz-1', true),
  ('KZ', '{"ru": "Казахстан", "en": "Kazakhstan"}',                            'KZT', 'ru',      '+7',   'kz-1', false),
  ('AE', '{"en": "United Arab Emirates"}',                                     'AED', 'en',      '+971', 'me-1', false);

INSERT INTO cities (country_code, slug, name, timezone, center, default_currency, is_active) VALUES
  ('UZ', 'tashkent',  '{"uz-Latn": "Toshkent", "uz-Cyrl": "Тошкент", "ru": "Ташкент", "en": "Tashkent"}',
   'Asia/Tashkent',  ST_SetSRID(ST_MakePoint(69.2401, 41.2995), 4326)::geography, 'UZS', true),
  ('UZ', 'samarkand', '{"uz-Latn": "Samarqand", "uz-Cyrl": "Самарқанд", "ru": "Самарканд", "en": "Samarkand"}',
   'Asia/Samarkand', ST_SetSRID(ST_MakePoint(66.9597, 39.6542), 4326)::geography, 'UZS', true);

INSERT INTO sports (code, name, default_players_per_side) VALUES
  ('football',   '{"uz-Latn": "Futbol",    "ru": "Футбол",    "en": "Football"}',   7),
  ('basketball', '{"uz-Latn": "Basketbol", "ru": "Баскетбол", "en": "Basketball"}', 5),
  ('volleyball', '{"uz-Latn": "Voleybol",  "ru": "Волейбол",  "en": "Volleyball"}', 6);

INSERT INTO amenities (code, name, icon) VALUES
  ('parking',        '{"uz-Latn": "Avtoturargoh", "ru": "Парковка",    "en": "Parking"}',        'car'),
  ('shower',         '{"uz-Latn": "Dush",         "ru": "Душ",         "en": "Shower"}',         'shower'),
  ('changing_room',  '{"uz-Latn": "Kiyinish xonasi", "ru": "Раздевалка", "en": "Changing room"}', 'shirt'),
  ('lighting',       '{"uz-Latn": "Yoritish",     "ru": "Освещение",   "en": "Floodlights"}',    'light'),
  ('drinking_water', '{"uz-Latn": "Ichimlik suvi", "ru": "Питьевая вода", "en": "Drinking water"}', 'water');

INSERT INTO cancellation_policies (code, name, rules, is_default) VALUES
  ('standard', '{"uz-Latn": "Standart", "en": "Standard"}',
   '[{"min_hours_before": 24, "refund_pct": 100, "destination": "original_method"},
     {"min_hours_before": 3,  "refund_pct": 100, "destination": "wallet"},
     {"min_hours_before": 0,  "refund_pct": 0}]', true);

INSERT INTO payment_provider_configs (country_code, provider, currencies, priority, is_enabled, merchant_id, secret_ref) VALUES
  ('UZ', 'wallet', '{UZS}',  5, true,  NULL,          'none'),
  ('UZ', 'payme',  '{UZS}', 10, true,  'demo-payme',  'vault:kv/payments/uz/payme'),
  ('UZ', 'click',  '{UZS}', 20, true,  'demo-click',  'vault:kv/payments/uz/click'),
  ('UZ', 'uzum',   '{UZS}', 30, true,  'demo-uzum',   'vault:kv/payments/uz/uzum'),
  ('AE', 'stripe', '{AED,USD}', 10, false, NULL,      'vault:kv/payments/ae/stripe');

-- -----------------------------------------------------------------------------
-- Users: 1 admin, 1 host, 30 player (+998 90 200 00 01 .. 30)
-- -----------------------------------------------------------------------------
INSERT INTO users (phone_e164, display_name, first_name, country_code, home_city_id, data_region, onboarded_at)
SELECT phone, name, name, 'UZ', (SELECT id FROM cities WHERE slug = 'tashkent'), 'uz-1', now()
FROM (VALUES ('+998901110001', 'Demo Admin'), ('+998901110002', 'Demo Host')) v(phone, name);

INSERT INTO users (phone_e164, display_name, first_name, country_code, home_city_id, data_region, onboarded_at)
SELECT '+99890200' || lpad(n::text, 4, '0'), 'Player ' || n, 'Player', 'UZ',
       (SELECT id FROM cities WHERE slug = 'tashkent'), 'uz-1', now()
FROM generate_series(1, 30) n;

INSERT INTO auth_identities (user_id, provider, provider_uid)
SELECT id, 'phone', phone_e164 FROM users;

INSERT INTO user_roles (user_id, role)
SELECT id, 'player'::user_role FROM users
UNION ALL SELECT id, 'admin' FROM users WHERE phone_e164 = '+998901110001'
UNION ALL SELECT id, 'host'  FROM users WHERE phone_e164 = '+998901110002';

INSERT INTO player_sport_profiles (user_id, sport_id, self_level)
SELECT u.id, s.id, (ARRAY['beginner', 'intermediate', 'advanced']::skill_level[])[1 + (row_number() OVER () % 3)]
FROM users u CROSS JOIN sports s
WHERE s.code = 'football' AND u.phone_e164 LIKE '+99890200%';

INSERT INTO consents (user_id, purpose, granted, document_version, source)
SELECT u.id, p.purpose, true, '2026-10', 'onboarding'
FROM users u
CROSS JOIN (VALUES ('terms_of_service'::consent_purpose), ('privacy_policy'), ('media_appearance')) p(purpose);

INSERT INTO host_profiles (user_id, status, home_city_id, base_location, max_travel_km, has_kit, verified_at)
SELECT id, 'active', home_city_id, ST_SetSRID(ST_MakePoint(69.2100, 41.2850), 4326)::geography, 12, true, now()
FROM users WHERE phone_e164 = '+998901110002';

INSERT INTO host_sports (user_id, sport_id)
SELECT hp.user_id, s.id FROM host_profiles hp CROSS JOIN sports s WHERE s.code IN ('football', 'basketball');

-- -----------------------------------------------------------------------------
-- Venues va pitch'lar
-- -----------------------------------------------------------------------------
INSERT INTO venues (city_id, name, slug, address, location, timezone, partner_name)
SELECT c.id, v.name, v.slug, v.address::jsonb, ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography, c.timezone, 'Demo Partner LLC'
FROM (VALUES
  ('tashkent',  'Chilonzor Arena',         'chilonzor-arena',   '{"uz-Latn": "Chilonzor tumani, Toshkent"}', 69.2034, 41.2756),
  ('tashkent',  'Yunusobod Sport Complex', 'yunusobod-sport',   '{"uz-Latn": "Yunusobod tumani, Toshkent"}', 69.2870, 41.3640),
  ('samarkand', 'Samarqand Mini Field',    'samarkand-mini',    '{"uz-Latn": "Samarqand shahri"}',           66.9750, 39.6547)
) v(city, name, slug, address, lng, lat)
JOIN cities c ON c.slug = v.city;

INSERT INTO pitches (venue_id, name, surface, is_indoor, length_m, width_m, max_players_per_side)
SELECT ve.id, p.name, p.surface::surface_type, p.indoor, p.len, p.wid, p.per_side
FROM (VALUES
  ('chilonzor-arena', 'Pitch A', 'artificial_turf', false, 60.0, 40.0, 8),
  ('yunusobod-sport', 'Pitch 1', 'artificial_turf', false, 40.0, 20.0, 6),
  ('yunusobod-sport', 'Hall',    'indoor_parquet',  true,  28.0, 15.0, 5),
  ('samarkand-mini',  'Main',    'artificial_turf', false, 60.0, 40.0, 8)
) p(venue, name, surface, indoor, len, wid, per_side)
JOIN venues ve ON ve.slug = p.venue;

INSERT INTO pitch_sports (pitch_id, sport_id)
SELECT p.id, s.id FROM pitches p JOIN sports s ON s.code = CASE WHEN p.name = 'Hall' THEN 'basketball' ELSE 'football' END;

INSERT INTO venue_amenities (venue_id, amenity_id)
SELECT v.id, a.id FROM venues v CROSS JOIN amenities a
WHERE a.code IN ('parking', 'lighting', 'changing_room') OR (v.slug = 'yunusobod-sport' AND a.code = 'shower');

-- -----------------------------------------------------------------------------
-- Waiver: general_liability v1 (uz-Latn, ru) + barcha playerlar imzosi
-- -----------------------------------------------------------------------------
INSERT INTO waiver_templates (code, version, locale, country_code, title, body_md, effective_from) VALUES
  ('general_liability', 1, 'uz-Latn', 'UZ', 'Javobgarlikdan voz kechish',
   'Men havaskor sport o''yinida ixtiyoriy ishtirok etayotganimni va jarohat xavfini tushunishimni tasdiqlayman...', now() - interval '30 days'),
  ('general_liability', 1, 'ru', 'UZ', 'Отказ от ответственности',
   'Я подтверждаю, что добровольно участвую в любительской игре и осознаю риск травмы...', now() - interval '30 days');

INSERT INTO waiver_signatures (user_id, template_id, document_sha256, method, ip, app_version)
SELECT u.id, t.id, t.body_sha256, 'clickwrap', '10.0.0.1', '1.0.0'
FROM users u
JOIN waiver_templates t ON t.code = 'general_liability' AND t.version = 1 AND t.locale = 'uz-Latn'
WHERE u.phone_e164 LIKE '+99890200%';

-- -----------------------------------------------------------------------------
-- Lease + match + 2 side (Oranges/Blues). Session-local helper.
-- -----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.seed_match(
  p_code text, p_venue text, p_pitch text, p_sport text,
  p_day_offset int, p_hour int, p_format text, p_per_side int,
  p_min int, p_max int, p_price bigint, p_status match_status
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_pitch   pitches%ROWTYPE;
  v_venue   venues%ROWTYPE;
  v_starts  timestamptz;
  v_lease   uuid;
  v_match   uuid;
  v_admin   uuid := (SELECT id FROM users WHERE phone_e164 = '+998901110001');
BEGIN
  SELECT * INTO v_venue FROM venues WHERE slug = p_venue;
  SELECT * INTO v_pitch FROM pitches WHERE venue_id = v_venue.id AND name = p_pitch;
  -- Mahalliy vaqt bo'yicha: bugun + p_day_offset kun, soat p_hour:00
  v_starts := (date_trunc('day', now() AT TIME ZONE v_venue.timezone)
               + make_interval(days => p_day_offset, hours => p_hour)) AT TIME ZONE v_venue.timezone;

  INSERT INTO field_leases (pitch_id, period, cost_amount, currency, status, created_by)
  VALUES (v_pitch.id, tstzrange(v_starts, v_starts + interval '90 minutes', '[)'),
          p_price * p_max * 6 / 10, 'UZS', 'confirmed', v_admin)
  RETURNING id INTO v_lease;

  INSERT INTO matches (public_code, sport_id, pitch_id, lease_id, city_id, location, title,
                       starts_at, ends_at, format, players_per_side, min_players, max_players,
                       price_amount, currency, status, cancellation_policy_id,
                       booking_closes_at, min_players_deadline, host_fee_amount,
                       published_at, created_by)
  VALUES (p_code, (SELECT id FROM sports WHERE code = p_sport), v_pitch.id, v_lease, v_venue.city_id,
          v_venue.location, jsonb_build_object('uz-Latn', p_format || ' ' || v_venue.name),
          v_starts, v_starts + interval '90 minutes', p_format, p_per_side, p_min, p_max,
          p_price, 'UZS', p_status, (SELECT id FROM cancellation_policies WHERE is_default),
          v_starts - interval '30 minutes', v_starts - interval '3 hours', 15000000,
          CASE WHEN p_status <> 'draft' THEN now() END, v_admin)
  RETURNING id INTO v_match;

  INSERT INTO match_sides (match_id, side_no, label, bib_color) VALUES
    (v_match, 1, 'Oranges', '#FF7A00'),
    (v_match, 2, 'Blues',   '#1F6FEB');
  RETURN v_match;
END $$;

-- Narxlar tiyin'da: 4 500 000 tiyin = 45 000 so'm
DO $$
BEGIN
  PERFORM pg_temp.seed_match('MU-RACE', 'chilonzor-arena', 'Pitch A', 'football',   1, 19, '7v7', 7, 10, 14, 4500000, 'open');
  PERFORM pg_temp.seed_match('MU-YUN5', 'yunusobod-sport', 'Pitch 1', 'football',   2, 20, '5v5', 5,  8, 10, 3500000, 'open');
  PERFORM pg_temp.seed_match('MU-BSK1', 'yunusobod-sport', 'Hall',    'basketball', 2, 17, '5v5', 5,  8, 10, 3000000, 'open');
  PERFORM pg_temp.seed_match('MU-SAM1', 'samarkand-mini',  'Main',    'football',   1, 19, '7v7', 7, 10, 14, 4000000, 'open');
  PERFORM pg_temp.seed_match('MU-DRFT', 'chilonzor-arena', 'Pitch A', 'football',   3, 19, '7v7', 7, 10, 14, 4500000, 'draft');
END $$;

-- -----------------------------------------------------------------------------
-- Mavjud confirmed booking (Payme orqali to'langan) — Phase 2 migratsiyasidan keyin
-- o'zgarmay qolishini tekshirish uchun.
-- -----------------------------------------------------------------------------
WITH usr AS (
  SELECT u.id AS user_id, ws.id AS signature_id
  FROM users u JOIN waiver_signatures ws ON ws.user_id = u.id
  WHERE u.phone_e164 = '+998902000030'
), m AS (
  UPDATE matches SET confirmed_slots = confirmed_slots + 1
  WHERE public_code = 'MU-YUN5'
  RETURNING id, price_amount, currency
), b AS (
  INSERT INTO bookings (user_id, match_id, seats, unit_price_amount, total_amount, currency, status,
                        waiver_signature_id, idempotency_key, confirmed_at)
  SELECT usr.user_id, m.id, 1, m.price_amount, m.price_amount, m.currency, 'confirmed',
         usr.signature_id, 'seed-yun5-30', now()
  FROM usr, m
  RETURNING id, user_id, match_id, total_amount, currency
), pr AS (
  INSERT INTO match_participants (match_id, booking_id, user_id, side_no, status, source)
  SELECT match_id, id, user_id, 1, 'confirmed', 'booking' FROM b
)
INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id,
                      provider_state, succeeded_at)
SELECT id, user_id, 'payme', total_amount, currency, 'succeeded', '5e730e8e0b852a417aa49ceb',
       jsonb_build_object('state', 2,
                          'create_time',  (extract(epoch FROM now() - interval '5 minutes') * 1000)::bigint,
                          'perform_time', (extract(epoch FROM now()) * 1000)::bigint),
       now()
FROM b;

-- Basketbol match'iga host tayinlangan
INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at, responded_at)
SELECT m.id, hp.user_id, 'accepted', m.host_fee_amount, m.currency, now() + interval '10 minutes', now()
FROM matches m CROSS JOIN host_profiles hp
WHERE m.public_code = 'MU-BSK1';

COMMIT;
