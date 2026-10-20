#!/usr/bin/env bash
# =============================================================================
# DB qatlamini noldan tekshiradi (alohida matchup_test bazasida, dev ma'lumotlariga tegmaydi):
#   migratsiyalar -> seed -> invariantlar -> oversell race -> to'lov/expiry/cancel oqimi
#   -> discovery + dispatch -> Phase 2 migratsiyasi -> Phase 2 invariantlari.
# Ishga tushirish:
#   lokal:  docker compose up -d db && ./db/tests/verify.sh        (psql/pgbench db konteyneri ichida)
#   CI:     DATABASE_URL=postgres://user:pass@host:5432/postgres ./db/tests/verify.sh
#           (psql/pgbench 18 PATH'da; DATABASE_URL faqat server va credential'lar uchun —
#            undagi bazaga tegilmaydi, test bazasi `postgres` bazasi orqali qayta yaratiladi)
#   VERIFY_DB=boshqa_nom — test bazasi nomi (standart: matchup_test)
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

DB=${VERIFY_DB:-matchup_test}
if [ -n "${DATABASE_URL:-}" ]; then
  # DATABASE_URL dagi baza nomini $1 ga almashtiradi (query parametrlar, masalan sslmode, saqlanadi)
  dsn() {
    local base=${DATABASE_URL%%\?*} query=''
    [[ $DATABASE_URL == *\?* ]] && query="?${DATABASE_URL#*\?}"
    [[ ${base#*://} == */* ]] && base=${base%/*}
    printf '%s/%s%s' "$base" "$1" "$query"
  }
  run_psql()    { local db=$1; shift; psql "$(dsn "$db")" "$@"; }
  run_pgbench() { local db=$1; shift; pgbench "$@" "$(dsn "$db")"; }
  F=db    # SQL fayllar repo ichidan (nisbiy yo'l: psql NOTICE prefiksi bo'shliqsiz qoladi)
else
  run_psql()    { local db=$1; shift; docker compose exec -T db psql -U matchup -d "$db" "$@"; }
  run_pgbench() { local db=$1; shift; docker compose exec -T db pgbench -U matchup "$@" "$db"; }
  F=/db   # docker-compose.yml: ./db konteynerda /db ga ulangan
fi
psql_c() { run_psql "$DB" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
psql_f() { local f=$1; shift; run_psql "$DB" -X -q -v ON_ERROR_STOP=1 "$@" -f "$f"; }
step()   { printf '\n== %s\n' "$*"; }
assert_eq() {
  if [ "$1" != "$2" ]; then echo "FAIL: $3 (kutilgan=$2, olingan=$1)"; exit 1; fi
  echo "PASS: $3"
}
race_state() { psql_c "SELECT held_slots || '/' || confirmed_slots || '/' || status FROM matches WHERE public_code = 'MU-RACE'"; }
confirm_all_pending() {
  for b in $(psql_c "SELECT b.id FROM bookings b JOIN matches m ON m.id = b.match_id
                     WHERE m.public_code = 'MU-RACE' AND b.status = 'pending_payment' ORDER BY b.created_at"); do
    pid=$(psql_c "INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id)
                  SELECT id, user_id, 'payme', total_amount, currency, 'pending', 'pm-' || id FROM bookings WHERE id = '$b'
                  RETURNING id" | head -1)
    psql_f "$F/queries/confirm_payment.sql" -At -v payment_id="$pid" >/dev/null
  done
}

step "Test bazasini qayta yaratish ($DB)"
run_psql postgres -X -q -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"

step "0001_core_mvp.sql"
psql_f "$F/migrations/0001_core_mvp.sql"
echo "PASS: $(psql_c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'") ta jadval"

step "Seed"
psql_f "$F/seed/dev_seed.sql"
echo "PASS: $(psql_c "SELECT count(*) FROM matches") match, $(psql_c "SELECT count(*) FROM users") user"

step "MVP invariantlari"
psql_f "$F/tests/checks_mvp.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'

step "Oversell race: 30 parallel client -> MU-RACE (max 14)"
run_pgbench "$DB" -n -c 30 -j 6 -t 1 -f "$F/tests/oversell_hold.pgbench.sql" 2>&1 \
  | grep -E "number of (transactions actually processed|failed)" || true
assert_eq "$(race_state)" "14/0/open" "aniq 14 ta hold (held/confirmed/status)"
assert_eq "$(psql_c "SELECT count(*) FROM bookings b JOIN matches m ON m.id = b.match_id WHERE m.public_code = 'MU-RACE'")" \
          "14" "aniq 14 ta booking"
assert_eq "$(psql_c "SELECT count(*) FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                     WHERE m.public_code = 'MU-RACE' AND mp.status = 'held'")" "14" "aniq 14 ta roster qatori"

step "Hold seat (hold_seat.sql) — to'la match'ga 15-urinish"
read -r match_id user_id sig_id < <(psql_c "SELECT m.id, ws.user_id, ws.id FROM matches m, waiver_signatures ws
  JOIN users u ON u.id = ws.user_id WHERE m.public_code = 'MU-RACE' AND u.phone_e164 = '+998902000029'" | tr '|' ' ')
assert_eq "$(psql_f "$F/queries/hold_seat.sql" -At -v match_id="$match_id" -v user_id="$user_id" \
             -v signature_id="$sig_id" -v seats=1 -v idem=manual-1 | wc -l | tr -d ' ')" "0" "15-hold rad etildi (0 qator -> 409 MATCH_FULL)"

step "To'lov tasdiqlash: 1 ta booking"
b1=$(psql_c "SELECT b.id FROM bookings b JOIN matches m ON m.id = b.match_id WHERE m.public_code = 'MU-RACE' ORDER BY b.created_at LIMIT 1")
p1=$(psql_c "INSERT INTO payments (booking_id, user_id, provider, amount, currency, status, provider_transaction_id)
             SELECT id, user_id, 'payme', total_amount, currency, 'pending', 'pm-first' FROM bookings WHERE id = '$b1' RETURNING id" | head -1)
psql_f "$F/queries/confirm_payment.sql" -At -v payment_id="$p1" >/dev/null
assert_eq "$(race_state)" "13/1/open" "held 13 / confirmed 1"
psql_f "$F/queries/confirm_payment.sql" -At -v payment_id="$p1" >/dev/null
assert_eq "$(race_state)" "13/1/open" "takroriy webhook idempotent (holat o'zgarmadi)"

step "Hold expiry: 3 ta booking muddati o'tdi"
psql_c "UPDATE bookings SET expires_at = now() - interval '1 minute'
        WHERE id IN (SELECT b.id FROM bookings b JOIN matches m ON m.id = b.match_id
                     WHERE m.public_code = 'MU-RACE' AND b.status = 'pending_payment' ORDER BY b.created_at LIMIT 3)" >/dev/null
psql_f "$F/queries/expire_holds.sql" -At >/dev/null
assert_eq "$(race_state)" "10/1/open" "3 ta joy qaytarildi"

step "Qolgan 10 ta to'lov + yangi race (3 ta bo'sh joy) + tasdiqlash -> FULL"
confirm_all_pending
assert_eq "$(race_state)" "0/11/open" "11 ta confirmed"
run_pgbench "$DB" -n -c 30 -j 6 -t 1 -f "$F/tests/oversell_hold.pgbench.sql" >/dev/null 2>&1
assert_eq "$(race_state)" "3/11/open" "ikkinchi race'da aniq 3 ta hold"
confirm_all_pending
assert_eq "$(race_state)" "0/14/full" "match FULL"
assert_eq "$(psql_c "SELECT count(*) FROM outbox_events WHERE event_type = 'MatchFull'")" "1" "MatchFull outbox event (host dispatch trigger)"

step "Bekor qilish: full -> open"
bc=$(psql_c "SELECT b.id FROM bookings b JOIN matches m ON m.id = b.match_id WHERE m.public_code = 'MU-RACE' AND b.status = 'confirmed' LIMIT 1")
psql_f "$F/queries/cancel_booking.sql" -At -v booking_id="$bc" -v reason=user_cancel >/dev/null
assert_eq "$(race_state)" "0/13/open" "joy qaytdi, match yana open"

step "Discovery: Toshkent markazi, 15 km, football+basketball, 7 kun"
from=$(psql_c "SELECT to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SSOF')")
to=$(psql_c "SELECT to_char(now() + interval '7 days', 'YYYY-MM-DD\"T\"HH24:MI:SSOF')")
DISC=(-v lat=41.2995 -v lng=69.2401 -v radius_m=15000 -v sports=football,basketball
      -v date_from="$from" -v date_to="$to" -v min_slots=1 -v page_size=20)
psql_f "$F/queries/discovery.sql" -P pager=off "${DISC[@]}" | sed 's/^/   /'
assert_eq "$(psql_f "$F/queries/discovery.sql" -At "${DISC[@]}" | cut -d'|' -f2 | sort | tr '\n' ' ')" \
          "MU-BSK1 MU-RACE MU-YUN5 " "Samarqand (radiusdan tashqarida) va draft match chiqmadi"
step "Discovery index'i hajmda: +50 000 sintetik match (O'zbekiston bo'ylab, 60 kun)"
psql_c "INSERT INTO matches (public_code, sport_id, pitch_id, city_id, location, starts_at, ends_at, format,
                             players_per_side, min_players, max_players, price_amount, currency, status,
                             cancellation_policy_id, booking_closes_at, min_players_deadline, created_by)
        SELECT 'SYN-' || g, 1 + (g % 2), p.id, 1,
               ST_SetSRID(ST_MakePoint(67.5 + random() * 4, 39.5 + random() * 3), 4326)::geography,
               t, t + interval '90 minutes', '7v7', 7, 10, 14, 4500000, 'UZS', 'open', 1,
               t - interval '30 minutes', t - interval '3 hours', u.id
        FROM generate_series(1, 50000) g
        CROSS JOIN LATERAL (SELECT now() + interval '4 hours' + random() * interval '60 days' AS t) tt
        CROSS JOIN (SELECT id FROM pitches LIMIT 1) p
        CROSS JOIN (SELECT id FROM users WHERE phone_e164 = '+998901110001') u" >/dev/null
psql_c "ANALYZE matches" >/dev/null
plan=$( { echo "EXPLAIN (ANALYZE, COSTS OFF)"; cat db/queries/discovery.sql; } \
  | run_psql "$DB" -X -At "${DISC[@]}" )
echo "$plan" | grep -E "Index Scan (using|on) matches_|Execution Time" | sed 's/^ *\(-> *\)\{0,1\}/   /'
# Planner ma'lumot taqsimotiga qarab oddiy yoki bitmap index scan tanlaydi — ikkalasi ham to'g'ri
echo "$plan" | grep -qE "(Index Scan using|Bitmap Index Scan on) matches_discovery_gix" \
  && echo "PASS: geo + vaqt filtri bitta GiST index'da (matches_discovery_gix)" \
  || { echo "FAIL: discovery GiST index ishlatilmadi"; exit 1; }
psql_c "DELETE FROM matches WHERE public_code LIKE 'SYN-%'" >/dev/null

step "Host dispatch nomzodlari (MU-RACE)"
mr=$(psql_c "SELECT id FROM matches WHERE public_code = 'MU-RACE'")
psql_f "$F/queries/dispatch_candidates.sql" -P pager=off -v match_id="$mr" | sed 's/^/   /'

step "0002_phase2_competitions.sql (mavjud ma'lumotlar ustiga)"
before=$(psql_c "SELECT md5(string_agg(id::text || status::text || total_amount::text, ',' ORDER BY id)) FROM bookings")
psql_f "$F/migrations/0002_phase2_competitions.sql"
after=$(psql_c "SELECT md5(string_agg(id::text || status::text || total_amount::text, ',' ORDER BY id)) FROM bookings")
assert_eq "$after" "$before" "mavjud booking'lar o'zgarmadi"

step "Phase 2 invariantlari"
psql_f "$F/tests/checks_phase2.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'

printf '\nHAMMASI O‘TDI ✅\n'
