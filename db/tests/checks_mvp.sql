-- =============================================================================
-- MVP sxemasi invariantlari: har bir blok kutilgan xato bilan rad etilishini tekshiradi.
-- Kutilmagan muvaffaqiyat -> RAISE EXCEPTION 'FAIL ...' -> psql ON_ERROR_STOP bilan to'xtaydi.
-- =============================================================================
\set QUIET on

-- 1. Bitta pitch'ni ustma-ust vaqtga ikki marta ijaraga olib bo'lmaydi
DO $$
DECLARE v field_leases%ROWTYPE;
BEGIN
  SELECT * INTO v FROM field_leases l WHERE l.id = (SELECT lease_id FROM matches WHERE public_code = 'MU-RACE');
  BEGIN
    INSERT INTO field_leases (pitch_id, period, cost_amount, currency, created_by)
    VALUES (v.pitch_id, tstzrange(lower(v.period) + interval '30 minutes', upper(v.period) + interval '30 minutes'),
            1, 'UZS', v.created_by);
    RAISE EXCEPTION 'FAIL: ustma-ust lease qabul qilindi';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'PASS: ustma-ust lease EXCLUDE bilan rad etildi';
  END;
  -- Ketma-ket (tutash) slot esa ruxsat etiladi: [19:00, 20:30) va [20:30, 22:00)
  INSERT INTO field_leases (pitch_id, period, cost_amount, currency, created_by)
  VALUES (v.pitch_id, tstzrange(upper(v.period), upper(v.period) + interval '90 minutes'), 1, 'UZS', v.created_by);
  RAISE NOTICE 'PASS: tutash lease qabul qilindi';
END $$;

-- 2. Bitta o'yinchi bitta match'ga ikki marta faol yozila olmaydi
DO $$
BEGIN
  INSERT INTO match_participants (match_id, user_id, status, source)
  SELECT match_id, user_id, 'confirmed', 'admin_invite'
  FROM match_participants WHERE status = 'confirmed' LIMIT 1;
  RAISE EXCEPTION 'FAIL: dublikat participant qabul qilindi';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS: dublikat participant unique index bilan rad etildi';
END $$;

-- 3. Waiver imzosisiz match booking'i yaratib bo'lmaydi
DO $$
BEGIN
  INSERT INTO bookings (user_id, match_id, unit_price_amount, total_amount, currency, idempotency_key, expires_at)
  SELECT u.id, m.id, m.price_amount, m.price_amount, m.currency, 'no-waiver', now() + interval '15 minutes'
  FROM users u, matches m WHERE u.phone_e164 = '+998901110001' AND m.public_code = 'MU-YUN5';
  RAISE EXCEPTION 'FAIL: waiver''siz booking qabul qilindi';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS: waiver''siz booking CHECK bilan rad etildi';
END $$;

-- 4. Booking summasi noto'g'ri hisoblangan bo'lsa rad etiladi
DO $$
BEGIN
  INSERT INTO bookings (user_id, match_id, seats, unit_price_amount, total_amount, currency,
                        waiver_signature_id, idempotency_key, expires_at)
  SELECT ws.user_id, m.id, 2, m.price_amount, m.price_amount, m.currency, ws.id, 'bad-math', now() + interval '15 minutes'
  FROM waiver_signatures ws, matches m WHERE m.public_code = 'MU-YUN5' LIMIT 1;
  RAISE EXCEPTION 'FAIL: noto''g''ri summa qabul qilindi';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS: total_amount != unit_price * seats rad etildi';
END $$;

-- 5. Match sig'imidan oshib ketish (oxirgi himoya chizig'i)
DO $$
BEGIN
  UPDATE matches SET held_slots = max_players - confirmed_slots + 1 WHERE public_code = 'MU-YUN5';
  RAISE EXCEPTION 'FAIL: sig''imdan oshish qabul qilindi';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS: held + confirmed > max_players CHECK bilan rad etildi';
END $$;

-- 6. Imzolangan waiver'ni o'zgartirib/o'chirib bo'lmaydi
DO $$
BEGIN
  UPDATE waiver_signatures SET ip = '1.1.1.1' WHERE id = (SELECT id FROM waiver_signatures LIMIT 1);
  RAISE EXCEPTION 'FAIL: waiver_signatures UPDATE qabul qilindi';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'PASS: waiver_signatures append-only';
END $$;

-- 7. Nashr qilingan waiver matnini o'zgartirib bo'lmaydi (faqat yangi version)
DO $$
BEGIN
  UPDATE waiver_templates SET body_md = body_md || ' (edited)' WHERE locale = 'uz-Latn';
  RAISE EXCEPTION 'FAIL: waiver matni o''zgartirildi';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'PASS: waiver_templates matni o''zgarmas';
END $$;

-- 8. Bitta match'ga ikkinchi faol host tayinlab bo'lmaydi
DO $$
DECLARE v_host uuid;
BEGIN
  INSERT INTO users (phone_e164, display_name, country_code, data_region)
  VALUES ('+998901110003', 'Demo Host 2', 'UZ', 'uz-1') RETURNING id INTO v_host;
  INSERT INTO host_profiles (user_id, status, home_city_id) VALUES (v_host, 'active', 1);
  BEGIN
    INSERT INTO host_assignments (match_id, host_user_id, status, fee_amount, currency, offer_expires_at)
    SELECT id, v_host, 'accepted', host_fee_amount, currency, now() FROM matches WHERE public_code = 'MU-BSK1';
    RAISE EXCEPTION 'FAIL: ikkinchi faol host qabul qilindi';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: bitta match — bitta faol host';
  END;
END $$;

-- 9. Payme tranzaksiyasi dublikati (bitta provider_transaction_id) rad etiladi
DO $$
BEGIN
  INSERT INTO payments (booking_id, user_id, provider, amount, currency, provider_transaction_id)
  SELECT booking_id, user_id, provider, amount, currency, provider_transaction_id FROM payments LIMIT 1;
  RAISE EXCEPTION 'FAIL: dublikat provider tranzaksiyasi qabul qilindi';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'PASS: (provider, provider_transaction_id) unique';
END $$;
