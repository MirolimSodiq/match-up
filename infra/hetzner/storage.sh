#!/usr/bin/env bash
# Object Storage bucket'lari: mavjudligi va lifecycle qoidalari (Terraform'dagi media_raw/media qoidalari bilan bir xil).
# deploy.sh har deploy'da chaqiradi; sozlamalar oxirgi muvaffaqiyatli qo'llanishdan beri o'zgarmagan bo'lsa — hech narsa
# qilmaydi. Bucket'lar oldindan yaratiladi (Hetzner Console -> Object Storage, private). --force — baribir qo'llash.
set -euo pipefail

RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$RELEASE_DIR/lib.sh"

days() {
  local v
  v=$(env_get "$1" "$2")
  [[ $v =~ ^[1-9][0-9]{0,3}$ ]] || die "$1: kunlar soni kerak ($v)"
  printf '%s' "$v"
}

# Qoida: prefix bo'yicha muddat; 4-argument bo'lsa — tugallanmagan multipart'lar 3 kunda (API housekeeping'ining zaxirasi)
rule() {
  printf '{"Rules":[{"ID":"%s","Status":"Enabled","Filter":{"Prefix":"%s"},"Expiration":{"Days":%d}}' "$1" "$2" "$3"
  [[ -z ${4:-} ]] || printf ',{"ID":"abort-multipart","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":3}}'
  printf ']}'
}

# AbortIncompleteMultipartUpload'ni qo'llamaydigan S3 (MinIO) uchun — faqat muddat qoidasi bilan qayta
apply() {
  local bucket=$1
  shift
  aws_s3 s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$(rule "$@" abort)" 2>/dev/null && return
  log "$bucket: multipart qoidasi qabul qilinmadi — faqat muddat qoidasi"
  aws_s3 s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration "$(rule "$@")"
}

# Ulanish xatosining sababi. aws-cli Hetzner'ning xato javobida ko'pincha "argument of type 'NoneType'" deb yiqilib, asl
# xatoni yashiradi (aws/aws-cli#10161) — HTTP holati va S3 xato kodi --debug chiqishidan olinadi (kalitlar chiqmaydi)
s3_reason() {
  local out
  out=$(aws_s3 s3api list-objects-v2 --bucket "$1" --max-keys 1 --debug 2>&1 >/dev/null |
    grep -oE 'HTTP/1\.1" [0-9]{3}|<Code>[^<]+</Code>' | sed -E 's/^HTTP.* //; s#</?Code>##g' | sort -u | paste -sd' ' -) || true
  printf '%s' "${out:-javob kelmadi}"
}

main() {
  enter_home "$@"
  load_env
  local raw media backup raw_days rec_days backup_days stamp b
  raw=$(env_get MEDIA_RAW_BUCKET)
  media=$(env_get MEDIA_BUCKET)
  backup=$(env_get BACKUP_BUCKET)
  raw_days=$(days MEDIA_RAW_EXPIRATION_DAYS 3)
  rec_days=$(days MEDIA_RECORDING_EXPIRATION_DAYS 7)
  backup_days=$(days BACKUP_RETENTION_DAYS 14)

  # Xom yuklamalar: hammasi raw_days dan keyin (kliplar va HLS shu vaqtgacha tayyor bo'ladi). Natijalar: to'liq o'yin
  # HLS'i (recordings/) — API rec_days dan keyin ko'rsatmaydi, fayllar bir kun keyin o'chadi (segmentlar job davomida
  # yoziladi); kliplar (highlights/) o'chirilguncha qoladi. Backup'lar: postgres/ backup_days dan keyin
  stamp=$(printf '%s\n' "$(env_get S3_ENDPOINT)" "$raw" "$raw_days" "$media" "$rec_days" "$backup" "$backup_days" "$(rule x y 1 abort)" |
    sha256sum | cut -d' ' -f1)
  if [[ ${1:-} != --force && -f $STATE_DIR/storage.sha && $(<"$STATE_DIR/storage.sha") == "$stamp" ]]; then
    return 0
  fi

  for b in "$raw" "$media" "$backup"; do
    aws_s3 s3api head-bucket --bucket "$b" >/dev/null 2>&1 ||
      die "bucket '$b' ochilmadi ($(s3_reason "$b")). SignatureDoesNotMatch / InvalidAccessKeyId — S3 kalitlari noto'g'ri;" \
        "NoSuchBucket — bucket nomi yoki S3_ENDPOINT location'i; javob kelmadi — S3_ENDPOINT yoki tarmoq"
  done
  apply "$raw" raw-expire "" "$raw_days"
  apply "$media" recordings-expire recordings/ "$((rec_days + 1))"
  apply "$backup" backups-expire postgres/ "$backup_days"
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$stamp" >"$STATE_DIR/storage.sha"
  log "Lifecycle: $raw ($raw_days kun), $media (recordings/ $((rec_days + 1)) kun), $backup (postgres/ $backup_days kun)"
}

main "$@"
