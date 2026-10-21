#!/bin/sh
# MinIO bucket'larini yaratadi (idempotent): docker compose'dagi minio-init servisi ishga tushiradi.
#   matchup-media-raw — host yuklagan xom kliplar (faqat presigned PUT/GET, ochiq kirish yo'q)
#   matchup-media     — worker natijalari (HLS, thumbnail, 9:16 MP4) — faqat imzolangan URL bilan
set -eu

MC="${MC:-mc}"
ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
RAW_BUCKET="${MEDIA_RAW_BUCKET:-matchup-media-raw}"
OUT_BUCKET="${MEDIA_BUCKET:-matchup-media}"
RAW_EXPIRE_DAYS="${MEDIA_RAW_EXPIRATION_DAYS:-30}"

i=0
until "$MC" alias set local "$ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then echo "MinIO ($ENDPOINT) javob bermadi" >&2; exit 1; fi
  sleep 1
done

for b in "$RAW_BUCKET" "$OUT_BUCKET"; do
  "$MC" mb --ignore-existing "local/$b"
  "$MC" anonymous set none "local/$b"
done

# Xom video 30 kundan keyin o'chadi (S3 lifecycle bilan bir xil). Tugallanmagan multipart'lar MinIO'da
# avtomatik tozalanadi (api.stale_uploads_expiry, standart 24 soat).
"$MC" ilm rule ls "local/$RAW_BUCKET" 2>/dev/null | grep -q "Expiration" \
  || "$MC" ilm rule add --expire-days "$RAW_EXPIRE_DAYS" "local/$RAW_BUCKET"

echo "MinIO tayyor: $RAW_BUCKET, $OUT_BUCKET"
