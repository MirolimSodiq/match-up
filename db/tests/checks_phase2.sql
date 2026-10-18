-- =============================================================================
-- Phase 2 migratsiyasidan keyingi tekshiruvlar: jamoa turniri xuddi shu
-- bookings/payments/match_participants/match_sides orqali ishlaydi.
-- =============================================================================
\set QUIET on

DO $$
DECLARE
  v_captain  uuid := (SELECT id FROM users WHERE phone_e164 = '+998902000001');
  v_admin    uuid := (SELECT id FROM users WHERE phone_e164 = '+998901110001');
  v_team_a   uuid;
  v_team_b   uuid;
  v_comp     uuid;
  v_entry    uuid;
  v_booking  uuid;
  v_match    uuid;
  v_pts      bigint;
BEGIN
  INSERT INTO teams (sport_id, city_id, name, slug, captain_user_id)
  VALUES (1, 1, 'Chilonzor Lions', 'chilonzor-lions', v_captain) RETURNING id INTO v_team_a;
  INSERT INTO teams (sport_id, city_id, name, slug, captain_user_id)
  VALUES (1, 1, 'Yunusobod Eagles', 'yunusobod-eagles', v_admin) RETURNING id INTO v_team_b;
  INSERT INTO team_members (team_id, user_id, role, status, joined_at)
  VALUES (v_team_a, v_captain, 'captain', 'active', now());

  INSERT INTO competitions (type, sport_id, city_id, name, slug, team_size_min, team_size_max, max_teams,
                            entry_fee_amount, currency, status, cancellation_policy_id, created_by)
  VALUES ('league', 1, 1, '{"uz-Latn": "Toshkent Havaskorlar Ligasi"}', 'tashkent-amateur-league-2027',
          7, 12, 8, 120000000, 'UZS', 'registration_open', 1, v_admin)
  RETURNING id INTO v_comp;

  INSERT INTO competition_entries (competition_id, team_id, registered_by)
  VALUES (v_comp, v_team_a, v_captain) RETURNING id INTO v_entry;

  -- Jamoa to'lovi = oddiy booking (waiver CHECK faqat match_slot uchun)
  INSERT INTO bookings (user_id, bookable_type, competition_entry_id, unit_price_amount, total_amount,
                        currency, idempotency_key, expires_at)
  VALUES (v_captain, 'competition_entry', v_entry, 120000000, 120000000, 'UZS', 'entry-1', now() + interval '1 hour')
  RETURNING id INTO v_booking;
  -- ...va oddiy payment (o'sha Payme adapter)
  INSERT INTO payments (booking_id, user_id, provider, amount, currency, status)
  VALUES (v_booking, v_captain, 'payme', 120000000, 'UZS', 'pending');
  RAISE NOTICE 'PASS: competition_entry booking + payment core jadvallarda yaratildi';

  -- Exclusive arc: ikkala FK birdan to'ldirilsa rad etiladi
  BEGIN
    INSERT INTO bookings (user_id, bookable_type, competition_entry_id, match_id, unit_price_amount,
                          total_amount, currency, idempotency_key, expires_at)
    VALUES (v_captain, 'competition_entry', v_entry, (SELECT id FROM matches LIMIT 1), 1, 1, 'UZS', 'arc-bad',
            now() + interval '1 hour');
    RAISE EXCEPTION 'FAIL: ikki FK''li booking qabul qilindi';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: exclusive-arc CHECK ishlaydi';
  END;

  -- Liga o'yini = oddiy match + competition_id + side'larda team_id
  SELECT id INTO v_match FROM matches WHERE public_code = 'MU-YUN5';
  UPDATE matches SET competition_id = v_comp, round_label = 'Round 1' WHERE id = v_match;
  UPDATE match_sides SET team_id = CASE side_no WHEN 1 THEN v_team_a ELSE v_team_b END,
                         score   = CASE side_no WHEN 1 THEN 3 ELSE 1 END
  WHERE match_id = v_match;
  UPDATE matches SET status = 'completed', completed_at = now() WHERE id = v_match;

  INSERT INTO match_events (match_id, side_no, type, source, match_offset_ms, confidence)
  VALUES (v_match, 1, 'goal', 'ai', 754000, 0.912);

  SELECT points INTO v_pts FROM competition_standings WHERE competition_id = v_comp AND team_id = v_team_a;
  IF v_pts IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL: standings noto''g''ri (points=%)', v_pts;
  END IF;
  RAISE NOTICE 'PASS: competition_standings: g''olib jamoa 3 ochko';
END $$;
