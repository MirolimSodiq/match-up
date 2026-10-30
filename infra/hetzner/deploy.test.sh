#!/usr/bin/env bash
# deploy.sh testi — soxta `docker` va `curl` bilan (serversiz, CI'da ham): .env tekshiruvi, tartib (pull -> migratsiya ->
# servislar), registry login/logout, migratsiya xatosi, rollback, yozuv lane'i band, --restart.
#   infra/hetzner/deploy.test.sh
# check'dagi shartlar bitta qo'shtirnoqda va eval bilan bajariladi (SC2016, SC2034 — ataylab)
# shellcheck disable=SC2016,SC2034
set -euo pipefail
cd "$(dirname "$0")"
SRC=$PWD

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# --- Soxta docker: har chaqiruv calls.log ga (IMAGE_TAG va compose fayli bilan) --------------------------
cat >"$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
file=-
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do [[ ${args[i]} == -f ]] && file=${args[i + 1]:-}; done
echo "tag=${IMAGE_TAG:-} file=$file :: $*" >>"$STATE/calls.log"
case "$*" in
  login*) cat >"$STATE/login-token" ;;
  "compose "*" run "*migrate*) exit "${MIGRATE_EXIT:-0}" ;;
  "compose "*" up "*) [[ ${IMAGE_TAG:-} != "${UP_FAIL_TAG:-none}" ]] || exit 1 ;;
  "compose "*XPENDING*) echo "${PENDING:-0}" ;;
  "run "*head-bucket*) [[ -z ${STORAGE_FAIL:-} ]] || exit 1 ;;
  "image ls"*) printf '%s\n' "${IMAGES:-}" | sed '/^$/d' ;;
esac
exit 0
STUB
printf '#!/bin/sh\nexit 0\n' >"$WORK/bin/curl"
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

ENV_OK='API_DOMAIN=api.203-0-113-10.sslip.io
ADMIN_DOMAIN=admin.203-0-113-10.sslip.io
ACME_EMAIL=ops@example.com
ADMIN_ALLOW_IPS=198.51.100.7/32 2001:db8::/48
DB_PASSWORD=0123456789abcdef
MEDIA_WORKER_TOKEN="0123456789abcdef0123456789abcdef"
S3_ENDPOINT=https://hel1.your-objectstorage.com
S3_REGION=hel1
S3_ACCESS_KEY_ID=AKIA
S3_SECRET_ACCESS_KEY=secret
MEDIA_RAW_BUCKET=raw
MEDIA_BUCKET=media
BACKUP_BUCKET=backups
ESKIZ_EMAIL=sms@example.com
ESKIZ_PASSWORD=sms'

REGISTRY=ghcr.io/owner/repo
pass=0
# setup <nom> [.env matni]: toza MATCHUP_HOME, releases/r1 va r2 — shu papkadagi skriptlar nusxasi
setup() {
  export STATE=$WORK/state-$1 HOME_DIR=$WORK/home-$1
  rm -rf "$STATE" "$HOME_DIR"
  mkdir -p "$STATE" "$HOME_DIR/state" "$HOME_DIR/caddy"
  for r in r1 r2; do mkdir -p "$HOME_DIR/releases/$r" && cp "$SRC"/*.sh "$SRC"/compose.yml "$SRC"/Caddyfile "$HOME_DIR/releases/$r/"; done
  printf '%s\n' "${2:-$ENV_OK}" >"$HOME_DIR/.env"
  touch "$STATE/calls.log"
}
# Avvalgi deploy holati: current -> r1, teg r1
deployed_r1() {
  printf 'IMAGE_REGISTRY=%s\nIMAGE_TAG=r1\n' "$REGISTRY" >"$HOME_DIR/state/image.env"
  ln -s "$HOME_DIR/releases/r1" "$HOME_DIR/current"
  cp "$SRC/Caddyfile" "$HOME_DIR/caddy/Caddyfile"
  echo "2026-01-01T00:00:00Z r1" >"$HOME_DIR/state/deploys.log"
}
# deploy <release> [args...] — natija $STATE/out.log, exit kodi $code
deploy() {
  local release=$1
  shift
  code=0
  env PATH="$WORK/bin:$PATH" MATCHUP_HOME="$HOME_DIR" MATCHUP_DEPLOY_USER=matchup-test-no-such-user bash "$HOME_DIR/releases/$release/deploy.sh" "$@" \
    <<<"${TOKEN:-}" >"$STATE/out.log" 2>&1 || code=$?
}
check() {
  if eval "$2"; then pass=$((pass + 1)); echo "PASS: $1"; else echo "FAIL: $1"; echo "--- chiqish:"; cat "$STATE/out.log"; echo "--- chaqiruvlar:"; cat "$STATE/calls.log"; exit 1; fi
}
line_of() { grep -n -m1 -- "$1" "$STATE/calls.log" | cut -d: -f1; }

# 1. Birinchi deploy (login bilan)
setup first
TOKEN=ghs_test deploy r2 --login bot --registry "$REGISTRY" r2
check "first: exit 0" '((code == 0)) && grep -q "Deploy tugadi: r2" "$STATE/out.log"'
check "first: login ghcr.io, token stdin'dan, oxirida logout" '[[ $(cat "$STATE/login-token") == ghs_test ]] && grep -q ":: login ghcr.io -u bot --password-stdin" "$STATE/calls.log" && [[ $(tail -n1 "$STATE/calls.log") == *":: logout ghcr.io" ]]'
check "first: pull -> migratsiya -> up tartibi" '(( $(line_of " pull ") < $(line_of " run --rm --no-TTY migrate") && $(line_of " run --rm --no-TTY migrate") < $(line_of " up -d --wait") ))'
check "first: hammasi yangi teg va release compose'i bilan" '! grep "compose" "$STATE/calls.log" | grep -v "tag=r2 file=$HOME_DIR/releases/r2/compose.yml" | grep -q .'
check "first: barcha servislar, shu jumladan yozuv lane'i" 'grep " up -d --wait" "$STATE/calls.log" | grep -q "media-worker media-worker-recording$"'
check "first: holat yozildi" '[[ $(tr "\n" " " <"$HOME_DIR/state/image.env") == "IMAGE_REGISTRY=$REGISTRY IMAGE_TAG=r2 " && $(readlink "$HOME_DIR/current") == "$HOME_DIR/releases/r2" ]]'
check "first: Caddyfile o'rnatildi" 'cmp -s "$SRC/Caddyfile" "$HOME_DIR/caddy/Caddyfile"'
check "first: lifecycle (aws-cli) qo'llandi" 'grep -q "put-bucket-lifecycle-configuration --bucket raw" "$STATE/calls.log" && [[ -s $HOME_DIR/state/storage.sha ]]'

# 2. .env to'liq emas — docker umuman chaqirilmaydi
setup env-bad "$(sed -e 's/^S3_ACCESS_KEY_ID=.*/S3_ACCESS_KEY_ID=change-me/' -e '/^BACKUP_BUCKET=/d' <<<"$ENV_OK")
PAYME_KEY="
deploy r2 --registry "$REGISTRY" r2
check "env-bad: exit != 0, hamma xatolar ro'yxati" '((code != 0)) && grep -q "S3_ACCESS_KEY_ID: namuna" "$STATE/out.log" && grep -q "BACKUP_BUCKET: yo.q" "$STATE/out.log" && grep -q "PAYME_KEY: bo.sh" "$STATE/out.log"'
check "env-bad: docker chaqirilmagan" '[[ ! -s $STATE/calls.log ]]'

# 2b. Object Storage'ga ulanib bo'lmadi — migratsiya va servislarga tegilmaydi
setup storage-fail
deployed_r1
STORAGE_FAIL=1 deploy r2 r2
check "storage-fail: exit != 0 va sabab" '((code != 0)) && grep -q "Object Storage sozlanmadi" "$STATE/out.log"'
check "storage-fail: migratsiya va up chaqirilmagan, holat r1 da" '! grep -q " migrate\| up -d" "$STATE/calls.log" && grep -q "IMAGE_TAG=r1" "$HOME_DIR/state/image.env"'

# 3. Migratsiya xatosi — servislarga va holatga tegilmaydi
setup migrate-fail
deployed_r1
MIGRATE_EXIT=1 deploy r2 r2
check "migrate-fail: exit != 0" '((code != 0)) && grep -q "migratsiya xato" "$STATE/out.log"'
check "migrate-fail: up chaqirilmagan" '! grep -q " up -d" "$STATE/calls.log"'
check "migrate-fail: holat r1 da" 'grep -q "IMAGE_TAG=r1" "$HOME_DIR/state/image.env" && [[ $(readlink "$HOME_DIR/current") == "$HOME_DIR/releases/r1" ]]'

# 4. Servislar sog'lom bo'lmadi — oldingi release va teg bilan qaytariladi
setup rollback
deployed_r1
UP_FAIL_TAG=r2 deploy r2 r2
check "rollback: exit != 0 va sabab" '((code != 0)) && grep -q "r1 qaytarildi" "$STATE/out.log"'
check "rollback: ikkinchi up — r1 teg va r1 compose'i" 'grep " up -d --wait" "$STATE/calls.log" | tail -n1 | grep -q "tag=r1 file=$HOME_DIR/releases/r1/compose.yml"'
check "rollback: holat r1 da qoldi" 'grep -q "IMAGE_TAG=r1" "$HOME_DIR/state/image.env" && [[ $(readlink "$HOME_DIR/current") == "$HOME_DIR/releases/r1" ]] && ! grep -q " r2$" "$HOME_DIR/state/deploys.log"'

# 5. Yozuv lane'ida job ishlayapti — media-worker-recording qayta yaratilmaydi
setup busy
deployed_r1
PENDING=1 deploy r2 r2
check "busy: exit 0" '((code == 0))'
check "busy: up ro'yxatida media-worker-recording yo'q" 'grep " up -d --wait" "$STATE/calls.log" | grep -q "media-worker$" && ! grep " up -d --wait" "$STATE/calls.log" | grep -q "media-worker-recording"'
check "busy: sabab chiqarilgan" 'grep -q "media-worker-recording job ishlayapti" "$STATE/out.log"'

# 6. Caddyfile o'zgargan — reload; eski image'lar tozalanadi (oxirgi 3 deploy tegi qoladi)
setup caddy
deployed_r1
echo "# eski" >>"$HOME_DIR/caddy/Caddyfile"
IMAGES="$REGISTRY/api:r0
$REGISTRY/api:r1
$REGISTRY/api:old" deploy r2 r2
check "caddy: reload chaqirildi va fayl yangilandi" 'grep -q "exec -T caddy caddy reload" "$STATE/calls.log" && cmp -s "$SRC/Caddyfile" "$HOME_DIR/caddy/Caddyfile"'
check "caddy: deploys.log'da yo'q teglar o'chirildi, r1 qoldi" 'grep -q "image rm $REGISTRY/api:old" "$STATE/calls.log" && grep -q "image rm $REGISTRY/api:r0" "$STATE/calls.log" && ! grep -q "image rm $REGISTRY/api:r1" "$STATE/calls.log"'

# 7. --restart: joriy teg, migratsiya va pull'siz
setup restart
deployed_r1
deploy r1 --restart
check "restart: exit 0, joriy release va teg fayli bilan faqat up" '((code == 0)) && grep -q "file=$HOME_DIR/releases/r1/compose.yml :: compose .*--env-file $HOME_DIR/state/image.env up -d --wait" "$STATE/calls.log" && ! grep -q " pull \| migrate" "$STATE/calls.log"'

# 8. Yaroqsiz teg — hech narsa boshlanmaydi
setup bad-tag
deploy r2 --registry "$REGISTRY" 'r2;rm'
check "bad-tag: exit != 0, docker chaqirilmagan" '((code != 0)) && grep -q "yaroqsiz teg" "$STATE/out.log" && ! grep -q compose "$STATE/calls.log"'

echo "== $pass ta tekshiruv o'tdi"
