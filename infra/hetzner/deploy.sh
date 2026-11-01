#!/usr/bin/env bash
# Match Up — serverga deploy (docs/DEPLOYMENT.md §10). `deploy` foydalanuvchisi ishga tushiradi: GitHub Actions
# (deploy-hetzner.yml) SSH orqali yoki operator qo'lda. Skript o'zi turgan release papkasining compose.yml'ini ishlatadi.
#
#   releases/<sha>/deploy.sh [--login USER] [--registry REGISTRY] <tag>
#       yangi versiya: image'lar -> migratsiya -> servislar (sog'lom bo'lishi kutiladi) -> current -> tozalash.
#       --login: registry token'i stdin'dan (docker login, oxirida logout). Xato bo'lsa — oldingi versiya qaytariladi.
#   current/deploy.sh --restart
#       .env o'zgargandan keyin: joriy versiya, o'zgargan servislar qayta yaratiladi.
#
# Tartib (ecs-deploy.sh bilan bir xil g'oya): migratsiya servislardan oldin va orqaga mos (expand -> contract),
# shuning uchun rollback faqat image'larni qaytaradi. To'liq o'yin yozuvini kodlayotgan worker qayta yaratilmaydi —
# keyingi deploy'da (yoki --restart bilan) yangilanadi.
set -euo pipefail

RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$RELEASE_DIR/lib.sh"

# ESKIZ_* — API usiz start olmaydi (OTP_PROVIDER=eskiz)
REQUIRED=(API_DOMAIN ADMIN_DOMAIN ACME_EMAIL DB_PASSWORD MEDIA_WORKER_TOKEN
  S3_ENDPOINT S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY MEDIA_RAW_BUCKET MEDIA_BUCKET BACKUP_BUCKET
  ESKIZ_EMAIL ESKIZ_PASSWORD)
SERVICES=(caddy db redis api admin media-work-init media-worker media-worker-recording)
RECORDING_STREAM=matchup:media-jobs:recording
RECORDING_GROUP=media-worker
KEEP_RELEASES=5
KEEP_TAGS=3
WAIT_TIMEOUT=${DEPLOY_WAIT_TIMEOUT:-300}

usage() { sed -n '4,8p' "$0" >&2; exit 2; }

validate_env() {
  local k v errors=()
  for k in "${REQUIRED[@]}"; do
    v=$(env_get "$k")
    if [[ -z $v ]]; then errors+=("$k: yo'q")
    elif [[ $v == *change-me* || $v == *generated-by-bootstrap* ]]; then errors+=("$k: namuna qiymati almashtirilmagan")
    fi
  done
  for k in "${!ENV[@]}"; do
    [[ -n ${ENV[$k]} ]] || errors+=("$k: bo'sh — to'ldiring yoki qatorni o'chiring")
  done
  v=$(env_get MEDIA_WORKER_TOKEN)
  (( ${#v} >= 32 )) || errors+=("MEDIA_WORKER_TOKEN: kamida 32 belgi")
  if (( ${#errors[@]} )); then
    printf '  - %s\n' "${errors[@]}" >&2
    die "$ENV_FILE to'liq emas (namuna: $RELEASE_DIR/env.example)"
  fi
  [[ -n $(env_get PAYME_MERCHANT_ID) ]] || log "OGOHLANTIRISH: PAYME_* yo'q — Payme test kassasi bilan"
  [[ -n $(env_get CLICK_SERVICE_ID) ]] || log "OGOHLANTIRISH: CLICK_* yo'q — Click test qiymatlari bilan"
  if [[ -n $(env_get PAYME_MERCHANT_ID) && $(env_get PAYME_CHECKOUT_URL https://checkout.test.paycom.uz) == *test* ]]; then
    log "OGOHLANTIRISH: PAYME_CHECKOUT_URL test muhitiga qaraydi (production: https://checkout.paycom.uz)"
  fi
  if [[ -n $(env_get MULTICARD_APPLICATION_ID) && $(env_get MULTICARD_BASE_URL https://dev-mesh.multicard.uz) == *dev-mesh* ]]; then
    log "OGOHLANTIRISH: MULTICARD_BASE_URL sandbox'ga qaraydi (production: https://mesh.multicard.uz)"
  fi
}

# Sog'lom bo'lmagan servislar va ularning oxirgi loglari (bir martalik media-work-init muvaffaqiyatli tugagan bo'ladi)
show_failures() {
  local service health state
  compose ps -a >&2 || true
  compose ps -a --format '{{.Service}} {{.Health}} {{.State}}' 2>/dev/null | while read -r service health state; do
    [[ $health == unhealthy || $state == restarting || ($state == exited && $service != media-work-init) ]] || continue
    log "--- $service ($state${health:+, $health}) ---"
    compose logs --no-color --tail 25 "$service" >&2 || true
  done
}

state_get() { [[ -f $IMAGE_ENV ]] && sed -n "s/^$1=//p" "$IMAGE_ENV" | tail -1; }

# Yozuv lane'i hozir job ishlayaptimi (ACK qilinmagan xabar bor) — bo'lsa uni qayta yaratmaymiz
recording_busy() {
  local n
  n=$(compose exec -T redis valkey-cli XPENDING "$RECORDING_STREAM" "$RECORDING_GROUP" 2>/dev/null | head -1) || return 1
  [[ $n =~ ^[0-9]+$ ]] && (( n > 0 ))
}

up_services() {
  local services=() s busy=0
  if recording_busy; then
    busy=1
    log "media-worker-recording job ishlayapti — bu safar qayta yaratilmaydi (keyingi deploy yoki --restart)"
  fi
  for s in "${SERVICES[@]}"; do
    (( busy )) && [[ $s == media-worker-recording ]] && continue
    services+=("$s")
  done
  compose up -d --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans "${services[@]}"
}

install_caddyfile() {
  local dst="$MATCHUP_HOME/caddy/Caddyfile"
  cmp -s "$RELEASE_DIR/Caddyfile" "$dst" && return 0
  cp -p "$dst" "$dst.prev" 2>/dev/null || true
  install -m 0644 "$RELEASE_DIR/Caddyfile" "$dst"
  local out
  if out=$(compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then
    log "Caddyfile yangilandi"
  else
    printf '%s\n' "$out" | tail -n 5 >&2
    log "OGOHLANTIRISH: yangi Caddyfile yuklanmadi — oldingisi qaytarildi"
    if [[ -f $dst.prev ]]; then cp -p "$dst.prev" "$dst"; fi
  fi
}

# Tashqi yo'l: Caddy (TLS) -> API. Birinchi deploy'da sertifikat olinguncha biroz vaqt ketadi
smoke_test() {
  local domain
  domain=$(env_get API_DOMAIN)
  for _ in $(seq 1 30); do
    if curl -fsS -m 5 -o /dev/null --resolve "$domain:443:127.0.0.1" "https://$domain/health" 2>/dev/null; then
      log "https://$domain/health — OK"
      return 0
    fi
    sleep 2
  done
  log "OGOHLANTIRISH: https://$domain/health javob bermadi (DNS/TLS?) — matchup logs caddy"
}

prune() {
  local registry=$1 keep=() dir ref tag
  # Eski release papkalari (joriysi saqlanadi)
  # shellcheck disable=SC2012 # nomlar — commit SHA
  ls -1dt "$MATCHUP_HOME"/releases/*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r dir; do
    [[ $(cd "$dir" && pwd -P) == "$RELEASE_DIR" ]] || rm -rf -- "$dir"
  done
  # Image'lar: oxirgi KEEP_TAGS ta deploy (qo'lda rollback internet/registry'siz ham ishlaydi)
  mapfile -t keep < <(awk '{print $2}' "$STATE_DIR/deploys.log" 2>/dev/null | tac | awk '!seen[$0]++' | head -n "$KEEP_TAGS")
  docker image ls --filter "reference=$registry/*" --format '{{.Repository}}:{{.Tag}}' | while read -r ref; do
    tag=${ref##*:}
    [[ " ${keep[*]} " == *" $tag "* ]] || docker image rm "$ref" >/dev/null 2>&1 || true
  done
  docker image prune -f >/dev/null
}

deploy() {
  local tag=$1 registry=$2 prev_tag prev_release
  [[ $tag =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || die "yaroqsiz teg: $tag"
  [[ -n $registry ]] || die "registry noma'lum (--registry)"
  prev_tag=$(state_get IMAGE_TAG || true)
  prev_release=$(readlink -f "$MATCHUP_HOME/current" 2>/dev/null || true)

  export IMAGE_REGISTRY=$registry IMAGE_TAG=$tag COMPOSE_FILE_PATH="$RELEASE_DIR/compose.yml"
  log "Image'lar: $registry/{api,admin,media-worker}:$tag"
  compose pull --quiet api admin media-worker

  # Bucket'larga ulanib bo'lmasa (kalit, nom, endpoint) ilova video yuklay olmaydi — to'xtaymiz. storage.sh S3'ga faqat
  # sozlamalar o'zgarganda murojaat qiladi, shuning uchun oddiy deploy'ni vaqtinchalik S3 uzilishi to'xtatmaydi
  "$RELEASE_DIR/storage.sh" || die "Object Storage sozlanmadi (storage.sh) — .env dagi S3_* qiymatlarini tekshiring"

  log "Migratsiya"
  compose run --rm --no-TTY migrate || die "migratsiya xato — servislarga tegilmadi"

  [[ -f $MATCHUP_HOME/caddy/Caddyfile ]] || install -m 0644 "$RELEASE_DIR/Caddyfile" "$MATCHUP_HOME/caddy/Caddyfile"
  log "Servislar ($tag)"
  if ! up_services; then
    show_failures
    if [[ -n $prev_tag && -n $prev_release && -f $prev_release/compose.yml && $prev_tag != "$tag" ]]; then
      log "Rollback: $prev_tag"
      IMAGE_TAG=$prev_tag COMPOSE_FILE_PATH="$prev_release/compose.yml" up_services || log "rollback ham muvaffaqiyatsiz"
      notify "deploy $tag xato, $prev_tag qaytarildi"
      die "servislar sog'lom bo'lmadi — $prev_tag qaytarildi"
    fi
    notify "deploy $tag xato"
    die "servislar sog'lom bo'lmadi"
  fi
  install_caddyfile

  printf 'IMAGE_REGISTRY=%s\nIMAGE_TAG=%s\n' "$registry" "$tag" >"$IMAGE_ENV.tmp" && mv "$IMAGE_ENV.tmp" "$IMAGE_ENV"
  ln -sfn "$RELEASE_DIR" "$MATCHUP_HOME/current.tmp" && mv -T "$MATCHUP_HOME/current.tmp" "$MATCHUP_HOME/current"
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$tag" >>"$STATE_DIR/deploys.log"
  log "Deploy tugadi: $tag"

  smoke_test
  prune "$registry" || log "OGOHLANTIRISH: eski release/image tozalashda xato"
}

main() {
  enter_home "$@"
  local login_user="" registry="" restart=0 token out
  while (( $# )); do
    case $1 in
      --login) login_user=${2:?}; shift 2 ;;
      --registry) registry=${2:?}; shift 2 ;;
      --restart) restart=1; shift ;;
      -h|--help) usage ;;
      -*) usage ;;
      *) break ;;
    esac
  done
  mkdir -p "$STATE_DIR" "$MATCHUP_HOME/caddy"
  exec 9>"$STATE_DIR/deploy.lock"
  flock -w 900 9 || die "boshqa deploy tugamadi (15 daqiqa)"

  load_env
  validate_env
  registry=${registry:-$(state_get IMAGE_REGISTRY || true)}

  if (( restart )); then
    (( $# == 0 )) || usage
    export COMPOSE_FILE_PATH="$RELEASE_DIR/compose.yml"
    [[ -n $(state_get IMAGE_TAG || true) ]] || die "hali deploy qilinmagan"
    install_caddyfile
    up_services
    smoke_test
    return
  fi

  (( $# == 1 )) || usage
  if [[ -n $login_user ]]; then
    IFS= read -r token || [[ -n ${token:-} ]] || die "--login: token stdin'da yo'q"
    # shellcheck disable=SC2064 # registry hozirgi qiymati
    trap "docker logout '${registry%%/*}' >/dev/null 2>&1 || true" EXIT
    # docker'ning "credentials are stored unencrypted" ogohlantirishi chiqmasin — token deploy oxirida o'chiriladi
    if ! out=$(printf '%s' "$token" | docker login "${registry%%/*}" -u "$login_user" --password-stdin 2>&1); then
      printf '%s\n' "$out" >&2
      die "registry login xato (${registry%%/*})"
    fi
  fi
  deploy "$1" "$registry"
}

main "$@"
