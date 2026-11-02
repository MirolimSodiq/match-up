-- =============================================================================
-- Match Up — 0015: ma'lumotnomalar (valyutalar, mamlakatlar, shaharlar, sport turlari, qulayliklar,
-- bekor qilish siyosati, ichki hamyon)
--
-- FAQAT DATA, IDEMPOTENT (ON CONFLICT DO NOTHING). Oldin bu qatorlar faqat dev seed'da edi — production'da
-- (seed yuklanmaydi) birinchi login'da users.country_code -> countries FK xatosi (500) chiqardi.
--   * Mavjud qatorlarga tegilmaydi: operator o'zgartirgan nom/holat qayta yozilmaydi.
--   * Tashqi to'lov provider'lari (Payme, Click, Uzum, Multicard) bu yerda yo'q — merchant ma'lumotlari bilan
--     operator qo'shadi (DEPLOYMENT.md §10); faqat ichki hamyon ('wallet', secret yo'q).
--   * dev_seed.sql dagi xuddi shu qatorlar ham ON CONFLICT DO NOTHING bilan qoladi: db/tests/verify.sh seed'ni
--     0001 dan keyinoq (0015 siz) yuklaydi.
-- =============================================================================

INSERT INTO currencies (code, minor_unit, symbol, name) VALUES
  ('UZS', 2, 'so''m', '{"uz-Latn": "O''zbek so''mi", "ru": "Узбекский сум", "en": "Uzbekistani som"}'),
  ('USD', 2, '$',     '{"en": "US Dollar"}'),
  ('EUR', 2, '€',     '{"en": "Euro"}'),
  ('KZT', 2, '₸',     '{"en": "Kazakhstani tenge"}'),
  ('AED', 2, 'AED',   '{"en": "UAE Dirham"}')
ON CONFLICT DO NOTHING;

INSERT INTO countries (code, name, default_currency, default_locale, phone_prefix, data_region, is_active) VALUES
  ('UZ', '{"uz-Latn": "O''zbekiston", "ru": "Узбекистан", "en": "Uzbekistan"}', 'UZS', 'uz-Latn', '+998', 'uz-1', true),
  ('KZ', '{"ru": "Казахстан", "en": "Kazakhstan"}',                            'KZT', 'ru',      '+7',   'kz-1', false),
  ('AE', '{"en": "United Arab Emirates"}',                                     'AED', 'en',      '+971', 'me-1', false)
ON CONFLICT DO NOTHING;

INSERT INTO cities (country_code, slug, name, timezone, center, default_currency, is_active) VALUES
  ('UZ', 'tashkent',  '{"uz-Latn": "Toshkent", "uz-Cyrl": "Тошкент", "ru": "Ташкент", "en": "Tashkent"}',
   'Asia/Tashkent',  ST_SetSRID(ST_MakePoint(69.2401, 41.2995), 4326)::geography, 'UZS', true),
  ('UZ', 'samarkand', '{"uz-Latn": "Samarqand", "uz-Cyrl": "Самарқанд", "ru": "Самарканд", "en": "Samarkand"}',
   'Asia/Samarkand', ST_SetSRID(ST_MakePoint(66.9597, 39.6542), 4326)::geography, 'UZS', true)
ON CONFLICT DO NOTHING;

INSERT INTO sports (code, name, default_players_per_side) VALUES
  ('football',   '{"uz-Latn": "Futbol",    "ru": "Футбол",    "en": "Football"}',   7),
  ('basketball', '{"uz-Latn": "Basketbol", "ru": "Баскетбол", "en": "Basketball"}', 5),
  ('volleyball', '{"uz-Latn": "Voleybol",  "ru": "Волейбол",  "en": "Volleyball"}', 6)
ON CONFLICT DO NOTHING;

INSERT INTO amenities (code, name, icon) VALUES
  ('parking',        '{"uz-Latn": "Avtoturargoh", "ru": "Парковка",    "en": "Parking"}',        'car'),
  ('shower',         '{"uz-Latn": "Dush",         "ru": "Душ",         "en": "Shower"}',         'shower'),
  ('changing_room',  '{"uz-Latn": "Kiyinish xonasi", "ru": "Раздевалка", "en": "Changing room"}', 'shirt'),
  ('lighting',       '{"uz-Latn": "Yoritish",     "ru": "Освещение",   "en": "Floodlights"}',    'light'),
  ('drinking_water', '{"uz-Latn": "Ichimlik suvi", "ru": "Питьевая вода", "en": "Drinking water"}', 'water')
ON CONFLICT DO NOTHING;

INSERT INTO cancellation_policies (code, name, rules, is_default) VALUES
  ('standard', '{"uz-Latn": "Standart", "en": "Standard"}',
   '[{"min_hours_before": 24, "refund_pct": 100, "destination": "original_method"},
     {"min_hours_before": 3,  "refund_pct": 100, "destination": "wallet"},
     {"min_hours_before": 0,  "refund_pct": 0}]', true)
ON CONFLICT DO NOTHING;

INSERT INTO payment_provider_configs (country_code, provider, currencies, priority, is_enabled, merchant_id, secret_ref) VALUES
  ('UZ', 'wallet', '{UZS}', 5, true, NULL, 'none')
ON CONFLICT DO NOTHING;
