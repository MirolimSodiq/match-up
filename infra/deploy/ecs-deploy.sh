#!/usr/bin/env bash
# =============================================================================
# ECS deploy (Terraform'siz) — docs/DEPLOYMENT.md §6. CI (.github/workflows/deploy.yml) va operator uchun bir xil.
#
#   infra/deploy/ecs-deploy.sh <cell nomi> <image tegi>      masalan: matchup-staging 3f2c9e1...
#
# Image'lar ECR'da allaqachon bo'lishi kerak (CI build qiladi). Qadamlar:
#   1. /<cell>/deploy/config (Terraform yozadi) — cluster, ECR, servislar, migratsiya task'i
#   2. migratsiya: yangi image bilan task definition revision -> run-task -> exit code 0 bo'lishi shart
#      (expand -> contract: yangi sxema bilan eski kod ham ishlaydi, shuning uchun migratsiya kod'dan oldin)
#   3. har servis: joriy task definition'dan faqat image almashgan revision -> update-service
#   4. hammasi barqaror bo'lishini kutish; circuit breaker orqaga qaytargan bo'lsa — xato. `wait: false` servis
#      (task protection'li yozuv worker'i) kutilmaydi: ishlayotgan job tugaguncha eski task qoladi (soatlab)
#   5. joriy teglar -> SSM (/<cell>/image-tags/*): keyingi `terraform apply` shu versiyani saqlaydi
#
# Talab: aws CLI v2, jq. Credential: CI'da OIDC role, lokal — operator profili. AWS_REGION config'dan olinadi.
# =============================================================================
set -euo pipefail

NAME=${1:?cell nomi kerak, masalan matchup-staging}
TAG=${2:?image tegi kerak (git SHA)}
# Kutish chegaralari (soniya); testlar kichik qiymat beradi
POLL_SEC=${DEPLOY_POLL_SEC:-10}
MIGRATE_TIMEOUT_SEC=${DEPLOY_MIGRATE_TIMEOUT_SEC:-900}
STABLE_TIMEOUT_SEC=${DEPLOY_STABLE_TIMEOUT_SEC:-1200}

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
fail() { log "XATO: $*"; exit 1; }

CONFIG=$(aws ssm get-parameter --name "/$NAME/deploy/config" --query Parameter.Value --output text)
cfg() { jq -r "$1" <<<"$CONFIG"; }
export AWS_REGION=${AWS_REGION:-$(cfg .region)}
CLUSTER=$(cfg .cluster)
TAG_PREFIX=$(cfg .tag_prefix)
image_of() { printf '%s:%s' "$(cfg ".ecr[\"$1\"]")" "$TAG"; }

# Joriy task definition'dan faqat bitta konteynerning image'i almashgan yangi revision; ARN'ni qaytaradi.
# Qolgan hamma narsa (env, secret'lar, role'lar, resurslar) Terraform yozganicha qoladi.
register_with_image() {
  local from=$1 container=$2 image=$3 td input
  td=$(aws ecs describe-task-definition --task-definition "$from" --query taskDefinition --output json)
  jq -e --arg c "$container" 'any(.containerDefinitions[]; .name == $c)' <<<"$td" >/dev/null ||
    fail "$from: '$container' konteyneri yo'q"
  input=$(jq --arg c "$container" --arg img "$image" '
      (.containerDefinitions[] | select(.name == $c) | .image) = $img
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' <<<"$td")
  aws ecs register-task-definition --cli-input-json "$input" --query taskDefinition.taskDefinitionArn --output text
}

# --- 0. Image'lar mavjudmi ------------------------------------------------------------------
for repo in $(jq -r '[.migrate.repo, .services[].repo] | unique | .[]' <<<"$CONFIG"); do
  aws ecr describe-images --repository-name "$(cfg ".ecr[\"$repo\"]" | cut -d/ -f2-)" --image-ids "imageTag=$TAG" >/dev/null ||
    fail "ECR'da $repo:$TAG yo'q — avval image build/push qiling"
done
log "cell=$NAME cluster=$CLUSTER teg=$TAG"

# --- 1. Migratsiya ---------------------------------------------------------------------------
migrate_td=$(register_with_image "$(cfg .migrate.task_definition)" "$(cfg .migrate.container)" "$(image_of "$(cfg .migrate.repo)")")
log "migratsiya: $migrate_td"
network=$(jq -c '{awsvpcConfiguration: {subnets: .migrate.subnets, securityGroups: .migrate.security_groups, assignPublicIp: "DISABLED"}}' <<<"$CONFIG")
task_arn=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$migrate_td" --launch-type FARGATE \
  --network-configuration "$network" --started-by "deploy-${TAG:0:24}" --query 'tasks[0].taskArn' --output text)
[[ -n $task_arn && $task_arn != None ]] || fail "migratsiya task'i ishga tushmadi"

deadline=$((SECONDS + MIGRATE_TIMEOUT_SEC))
while :; do
  task=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" --query 'tasks[0]' --output json)
  [[ $(jq -r .lastStatus <<<"$task") == STOPPED ]] && break
  ((SECONDS < deadline)) || fail "migratsiya ${MIGRATE_TIMEOUT_SEC} s ichida tugamadi: $task_arn"
  sleep "$POLL_SEC"
done
exit_code=$(jq -r --arg c "$(cfg .migrate.container)" '.containers[] | select(.name == $c) | .exitCode // "null"' <<<"$task")
if [[ $exit_code != 0 ]]; then
  log "migratsiya xato qildi (exit=$exit_code, $(jq -r '.stoppedReason // ""' <<<"$task")). Log:"
  # awslogs stream: <prefix>/<konteyner>/<task id>
  aws logs get-log-events --log-group-name "$(cfg .migrate.log_group)" \
    --log-stream-name "migrate/$(cfg .migrate.container)/${task_arn##*/}" --limit 50 --query 'events[].message' --output text >&2 || true
  fail "migratsiya muvaffaqiyatsiz — servislar yangilanmadi"
fi
aws ssm put-parameter --name "$TAG_PREFIX/migrate" --value "$TAG" --type String --overwrite >/dev/null
log "migratsiya tugadi"

# --- 2. Servislar ----------------------------------------------------------------------------
declare -A want
services=()
while IFS=$'\t' read -r service container repo wait; do
  current=$(aws ecs describe-services --cluster "$CLUSTER" --services "$service" --query 'services[0].taskDefinition' --output text)
  [[ -n $current && $current != None ]] || fail "servis topilmadi: $service"
  want[$service]=$(register_with_image "$current" "$container" "$(image_of "$repo")")
  aws ecs update-service --cluster "$CLUSTER" --service "$service" --task-definition "${want[$service]}" >/dev/null
  if [[ $wait == false ]]; then
    log "$service -> ${want[$service]} (kutilmaydi: ishlayotgan job tugagach yangi versiyaga o'tadi)"
  else
    services+=("$service")
    log "$service -> ${want[$service]}"
  fi
done < <(jq -r '.services[] | [.service, .container, .repo, (if .wait == false then "false" else "true" end)] | @tsv' <<<"$CONFIG")

# --- 3. Barqarorlik --------------------------------------------------------------------------
# Har servis: yangi deployment COMPLETED (circuit breaker qaytarsa — FAILED) va yagona deployment
deadline=$((SECONDS + STABLE_TIMEOUT_SEC))
while :; do
  state=$(aws ecs describe-services --cluster "$CLUSTER" --services "${services[@]}" --output json)
  pending=0
  for service in "${services[@]}"; do
    primary=$(jq -c --arg s "$service" '.services[] | select(.serviceName == $s) | .deployments[] | select(.status == "PRIMARY")' <<<"$state")
    if [[ $(jq -r .taskDefinition <<<"$primary") != "${want[$service]}" ]]; then
      fail "$service: circuit breaker oldingi versiyaga qaytardi ($(jq -r .taskDefinition <<<"$primary")) — ECS event'larini ko'ring"
    fi
    case $(jq -r '.rolloutState // "IN_PROGRESS"' <<<"$primary") in
      COMPLETED) ;;
      FAILED) fail "$service: deployment FAILED — $(jq -r '.rolloutStateReason // ""' <<<"$primary")" ;;
      *) pending=$((pending + 1)) ;;
    esac
  done
  ((pending == 0)) && break
  ((SECONDS < deadline)) || fail "$pending ta servis ${STABLE_TIMEOUT_SEC} s ichida barqarorlashmadi"
  sleep "$POLL_SEC"
done

# --- 4. Joriy teglar -------------------------------------------------------------------------
for repo in $(jq -r '[.services[].repo] | unique | .[]' <<<"$CONFIG"); do
  aws ssm put-parameter --name "$TAG_PREFIX/$repo" --value "$TAG" --type String --overwrite >/dev/null
done
log "deploy tugadi: $TAG"
