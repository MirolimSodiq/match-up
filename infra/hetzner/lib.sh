# shellcheck shell=bash
# deploy.sh, backup.sh, restore.sh, storage.sh uchun umumiy funksiyalar (source qilinadi).

MATCHUP_HOME=${MATCHUP_HOME:-/opt/matchup}
ENV_FILE="$MATCHUP_HOME/.env"
STATE_DIR="$MATCHUP_HOME/state"
IMAGE_ENV="$STATE_DIR/image.env"
# Backup/lifecycle uchun S3 client (Hetzner Object Storage — S3 API)
AWS_CLI_IMAGE=amazon/aws-cli:2.37.0

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "XATO: $*"; exit 1; }

# .env ni bash'da `source` qilinmaydi (ADMIN_ALLOW_IPS kabi bo'sh joyli qiymat buyruq bo'lib ketadi) —
# docker compose dotenv formatidagi KEY=VALUE qatorlari ENV massiviga o'qiladi.
declare -gA ENV=()
load_env() {
  local file=$ENV_FILE line key value
  [[ -r $file ]] || die "$file topilmadi yoki o'qib bo'lmaydi"
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || die "$file: tushunarsiz qator: $line"
    key=${BASH_REMATCH[2]}
    value=${BASH_REMATCH[3]}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    ENV[$key]=$value
  done <"$file"
}

env_get() { printf '%s' "${ENV[$1]:-${2:-}}"; }

# docker compose shu release'ning compose.yml'i bilan (`matchup` buyrug'i ham shuni chaqiradi)
compose() {
  local file=${COMPOSE_FILE_PATH:-$MATCHUP_HOME/current/compose.yml}
  local args=(-f "$file" --env-file "$ENV_FILE")
  [[ -f $IMAGE_ENV ]] && args+=(--env-file "$IMAGE_ENV")
  docker compose "${args[@]}" "$@"
}

# S3 buyrug'i (aws-cli konteynerida). Kalitlar buyruq qatoriga emas, docker CLI env'iga beriladi (`ps` da ko'rinmaydi).
# Hetzner/MinIO: checksum header'lari faqat kerak bo'lganda
aws_s3() {
  AWS_ACCESS_KEY_ID=$(env_get S3_ACCESS_KEY_ID) \
  AWS_SECRET_ACCESS_KEY=$(env_get S3_SECRET_ACCESS_KEY) \
  AWS_DEFAULT_REGION=$(env_get S3_REGION) \
  AWS_ENDPOINT_URL=$(env_get S3_ENDPOINT) \
    docker run --rm -i \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_ENDPOINT_URL \
      -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
      -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
      ${AWS_CLI_NETWORK:+--network "$AWS_CLI_NETWORK"} \
      "$AWS_CLI_IMAGE" "$@"
}

# Ops guruhiga xabar (TELEGRAM_BOT_TOKEN + OPS_TELEGRAM_CHAT_ID bo'lsa); xato bo'lsa jim
notify() {
  local token chat
  token=$(env_get TELEGRAM_BOT_TOKEN)
  chat=$(env_get OPS_TELEGRAM_CHAT_ID)
  [[ -n $token && -n $chat ]] || return 0
  curl -fsS -m 10 -o /dev/null "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=[matchup $(hostname)] $*" || true
}
