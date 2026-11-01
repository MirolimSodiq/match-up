#!/usr/bin/env bash
# PostgreSQL backup: pg_dump (custom format, siqilgan) -> Object Storage (BACKUP_BUCKET/postgres/...).
# matchup-backup.timer (bootstrap.sh) har kuni chaqiradi; qo'lda ham: /opt/matchup/current/backup.sh
# Saqlash muddati — bucket lifecycle (BACKUP_RETENTION_DAYS, storage.sh). Xato bo'lsa — Telegram ops guruhiga.
# Tiklash — restore.sh.
set -euo pipefail

RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$RELEASE_DIR/lib.sh"

key=''
on_exit() {
  local rc=$?
  (( rc == 0 )) || notify "backup xato (exit $rc): ${key:-?}"
}

main() {
  enter_home "$@"
  trap on_exit EXIT
  load_env
  local bucket size
  bucket=$(env_get BACKUP_BUCKET)
  key="postgres/matchup-$(date -u +%Y%m%dT%H%M%SZ).dump"

  log "pg_dump -> s3://$bucket/$key"
  compose exec -T db pg_dump -U matchup -d matchup --format=custom --compress=6 |
    aws_s3 s3 cp - "s3://$bucket/$key" --only-show-errors
  size=$(aws_s3 s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text)
  if ! [[ $size =~ ^[0-9]+$ ]] || (( size <= 1024 )); then
    die "backup yuklanmadi yoki juda kichik ($size)"
  fi

  mkdir -p "$STATE_DIR"
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$key" "$size" >>"$STATE_DIR/backups.log"
  log "OK: $key ($size bayt)"
}

main "$@"
