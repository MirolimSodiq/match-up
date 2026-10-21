#!/bin/sh
# API konteyner entrypoint'i. Ilova kalitlarni (Ed25519, CloudFront RSA) faqat fayldan o'qiydi (*_KEY_FILE).
# ECS Secrets Manager kalitni env'ga PEM matni sifatida beradi (JWT_PRIVATE_KEY=...) — shu yerda
# u yozish huquqi faqat process egasida bo'lgan faylga yoziladi, *_KEY_FILE o'rnatiladi va env'dan
# o'chiriladi. Fayl orqali kelsa (docker secrets, /run/secrets/...) hech narsa qilinmaydi.
set -eu

KEYS_DIR=${KEYS_DIR:-/tmp/matchup-keys}

key_from_env() {
  var=$1
  file=$2
  eval "value=\${$var:-}"
  [ -n "$value" ] || return 0
  mkdir -p "$KEYS_DIR"
  (umask 077 && printf '%s\n' "$value" > "$KEYS_DIR/$file")
  export "${var}_FILE=$KEYS_DIR/$file"
  unset "$var"
}

key_from_env JWT_PRIVATE_KEY jwt-private.pem
key_from_env JWT_PUBLIC_KEY jwt-public.pem
key_from_env TICKET_PRIVATE_KEY ticket-private.pem
key_from_env TICKET_PUBLIC_KEY ticket-public.pem
key_from_env MEDIA_CDN_PRIVATE_KEY cloudfront-media.pem
unset value

exec "$@"
