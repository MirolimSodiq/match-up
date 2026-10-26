#!/usr/bin/env bash
# Backup'dan tiklash (backup.sh yuklagan pg_dump). Joriy baza o'chirilmaydi — `matchup_before_<vaqt>` nomi bilan qoladi.
#
#   /opt/matchup/current/restore.sh list                 oxirgi backup'lar
#   /opt/matchup/current/restore.sh <key|latest> --yes   tiklash
#
# Tartib: backup yangi `matchup_restore` bazasiga (servislar ishlab turadi) -> ilova servislari to'xtatiladi ->
# joriy baza `matchup_before_<vaqt>` ga, tiklangan baza `matchup` ga qayta nomlanadi -> servislar ishga tushadi.
# Backup vaqtidan keyingi o'zgarishlar yangi bazada yo'q (eskisida qoladi). Valkey navbatlari tozalanmaydi.
set -euo pipefail

RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$RELEASE_DIR/lib.sh"

APP_SERVICES=(api admin media-worker media-worker-recording)

psql_admin() { compose exec -T -e PGOPTIONS='-c client_min_messages=warning' db psql -U matchup -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

list_backups() {
  # shellcheck disable=SC2016 # JMESPath literal
  aws_s3 s3api list-objects-v2 --bucket "$(env_get BACKUP_BUCKET)" --prefix postgres/ \
    --query 'sort_by(Contents || `[]`, &Key)[].[Key, Size, LastModified]' --output text
}

main() {
  load_env
  case ${1:-} in
    list) list_backups | tail -n 20; return ;;
    ''|-h|--help) sed -n '4,5p' "$0" >&2; exit 2 ;;
  esac
  local key=$1 bucket old
  [[ ${2:-} == --yes ]] || die "tasdiqlash uchun: restore.sh $key --yes"
  bucket=$(env_get BACKUP_BUCKET)
  if [[ $key == latest ]]; then
    key=$(list_backups | tail -n 1 | cut -f1)
    [[ -n $key && $key != None ]] || die "backup topilmadi (s3://$bucket/postgres/)"
  fi
  [[ $key =~ ^postgres/[A-Za-z0-9._-]+\.dump$ ]] || die "yaroqsiz kalit: $key"
  old="matchup_before_$(date -u +%Y%m%d%H%M%S)"

  log "s3://$bucket/$key -> matchup_restore"
  psql_admin -c 'DROP DATABASE IF EXISTS matchup_restore' -c 'CREATE DATABASE matchup_restore OWNER matchup'
  aws_s3 s3 cp "s3://$bucket/$key" - --only-show-errors |
    compose exec -T db pg_restore -U matchup -d matchup_restore --no-owner --exit-on-error --single-transaction

  log "Servislar to'xtatiladi, bazalar almashtiriladi ($old)"
  compose stop "${APP_SERVICES[@]}"
  psql_admin \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'matchup' AND pid <> pg_backend_pid()" \
    -c "ALTER DATABASE matchup RENAME TO $old" \
    -c 'ALTER DATABASE matchup_restore RENAME TO matchup'
  compose up -d --wait "${APP_SERVICES[@]}"
  notify "baza backup'dan tiklandi: $key (eskisi: $old)"
  log "Tayyor. Eski baza: $old — keraksiz bo'lsa: matchup exec db dropdb -U matchup $old"
}

main "$@"
