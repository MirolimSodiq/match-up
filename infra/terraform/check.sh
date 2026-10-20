#!/usr/bin/env bash
# terraform fmt -check va validate — hashicorp/terraform Docker image orqali (lokal va CI'da bir xil).
# AWS credential'lar kerak emas: backend ulanmaydi (-backend=false), plan/apply qilinmaydi.
set -euo pipefail
cd "$(dirname "$0")"

TF_IMAGE=${TF_IMAGE:-hashicorp/terraform:1.16.6}
tf() {
  local dir=$1; shift
  docker run --rm -v "$PWD:/tf" -v matchup-tf-plugin-cache:/plugin-cache \
    -e TF_PLUGIN_CACHE_DIR=/plugin-cache -e TF_IN_AUTOMATION=1 -w "/tf/$dir" "$TF_IMAGE" "$@"
}

echo "== terraform fmt -check"
tf . fmt -check -recursive -diff

for root in bootstrap envs/staging; do
  echo "== terraform validate: $root"
  tf "$root" init -backend=false -input=false -no-color >/dev/null
  tf "$root" validate -no-color
done
