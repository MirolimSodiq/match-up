#!/usr/bin/env bash
# ecs-deploy.sh testi — soxta `aws` CLI bilan (AWS'siz, CI'da ham): chaqiruvlar tartibi, image almashtirish,
# migratsiya xatosi, circuit breaker rollback va yo'q image. Talab: bash 4+, jq.
#   infra/deploy/ecs-deploy.test.sh
# check'dagi shartlar bitta qo'shtirnoqda va eval bilan bajariladi (SC2016, SC2034 — ataylab)
# shellcheck disable=SC2016,SC2034
set -euo pipefail
cd "$(dirname "$0")"
SCRIPT=$PWD/ecs-deploy.sh

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# --- Soxta aws ---------------------------------------------------------------------------------
# Holat $STATE papkasida: calls.log (har chaqiruv), td-<family>.json (ro'yxatdan o'tgan revision'lar),
# svc-<service> (joriy task definition), describe-tasks hisoblagichi.
cat >"$WORK/bin/aws" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >>"$STATE/calls.log"
arg() { local k=$1; shift; while (($#)); do [[ $1 == "$k" ]] && { echo "$2"; return; }; shift; done; }
op="$1 $2"; shift 2
case $op in
  "ssm get-parameter") cat "$STATE/config.json" ;;
  "ssm put-parameter") echo "$(arg --name "$@")=$(arg --value "$@")" >>"$STATE/ssm.log" ;;
  "ecr describe-images")
    [[ $(arg --repository-name "$@") == *"${MISSING_REPO:-none}" ]] && { echo "ImageNotFoundException" >&2; exit 254; }
    echo '{}' ;;
  "ecs describe-task-definition")
    from=$(arg --task-definition "$@")
    # ARN yoki family: oxirgi '/' dan keyingi, ':revision' siz
    family=${from##*/}; family=${family%%:*}
    container=$(jq -r --arg f "$family" '.containers[$f]' "$STATE/fixtures.json")
    jq -n --arg f "$family" --arg c "$container" '{
      taskDefinitionArn: "arn:aws:ecs:eu-central-1:1:task-definition/\($f):7", family: $f, revision: 7, status: "ACTIVE",
      requiresAttributes: [{name: "x"}], compatibilities: ["FARGATE"], registeredAt: "2026-01-01", registeredBy: "tf",
      networkMode: "awsvpc", cpu: "512", memory: "1024", executionRoleArn: "arn:exec", taskRoleArn: "arn:task",
      containerDefinitions: [
        {name: $c, image: "123.dkr.ecr/old:abc", environment: [{name: "NODE_ENV", value: "production"}],
         secrets: [{name: "DATABASE_URL", valueFrom: "arn:secret"}]},
        {name: "sidecar", image: "public/sidecar:1"}
      ]}' ;;
  "ecs register-task-definition")
    input=$(arg --cli-input-json "$@")
    family=$(jq -r .family <<<"$input")
    n=$(($(find "$STATE" -name "td-$family-*.json" | wc -l) + 8))
    echo "$input" >"$STATE/td-$family-$n.json"
    echo "arn:aws:ecs:eu-central-1:1:task-definition/$family:$n" ;;
  "ecs run-task") echo "arn:aws:ecs:eu-central-1:1:task/c/migr123" ;;
  "ecs describe-tasks")
    n=$(($(cat "$STATE/dt" 2>/dev/null || echo 0) + 1)); echo $n >"$STATE/dt"
    if ((n < 2)); then echo '{"lastStatus":"RUNNING","containers":[{"name":"migrate"}]}'
    else jq -n --argjson e "${MIGRATE_EXIT:-0}" '{lastStatus: "STOPPED", stoppedReason: "Essential container exited", containers: [{name: "migrate", exitCode: $e}]}'; fi ;;
  "logs get-log-events") echo "ERROR: relation \"x\" already exists" ;;
  "ecs describe-services")
    svcs=$(arg --services "$@")
    if [[ $(arg --output "$@") == text ]]; then echo "arn:aws:ecs:eu-central-1:1:task-definition/matchup-test-$svcs:7"; exit 0; fi
    # Barqarorlik: ikkinchi so'rovda COMPLETED; ROLLBACK_SERVICE — eski revision PRIMARY bo'lib qaytadi
    n=$(($(cat "$STATE/ds" 2>/dev/null || echo 0) + 1)); echo $n >"$STATE/ds"
    shift_svcs=("$svcs"); while (($#)); do [[ $1 == --services ]] && { shift; shift_svcs=(); while (($#)) && [[ $1 != --* ]]; do shift_svcs+=("$1"); shift; done; continue; }; shift; done
    for s in "${shift_svcs[@]}"; do
      td=$(cat "$STATE/svc-$s")
      [[ $s == "${ROLLBACK_SERVICE:-}" ]] && td="arn:aws:ecs:eu-central-1:1:task-definition/matchup-test-$s:7"
      state=$([[ $n -ge 2 ]] && echo COMPLETED || echo IN_PROGRESS)
      jq -n --arg s "$s" --arg td "$td" --arg st "$state" '{serviceName: $s, deployments: [{status: "PRIMARY", taskDefinition: $td, rolloutState: $st}]}'
    done | jq -s '{services: .}' ;;
  "ecs update-service") echo "$(arg --task-definition "$@")" >"$STATE/svc-$(arg --service "$@")" ;;
  *) echo "soxta aws: kutilmagan chaqiruv: $op $*" >&2; exit 99 ;;
esac
STUB
chmod +x "$WORK/bin/aws"

CONFIG='{
  "region": "eu-central-1", "cluster": "matchup-test", "tag_prefix": "/matchup-test/image-tags",
  "ecr": {"api": "123.dkr.ecr.eu-central-1.amazonaws.com/matchup-test/api",
          "admin": "123.dkr.ecr.eu-central-1.amazonaws.com/matchup-test/admin",
          "media-worker": "123.dkr.ecr.eu-central-1.amazonaws.com/matchup-test/media-worker"},
  "platform": "linux/arm64",
  "migrate": {"task_definition": "matchup-test-migrate", "container": "migrate", "repo": "api",
              "log_group": "/ecs/matchup-test/migrate", "subnets": ["subnet-a", "subnet-b"], "security_groups": ["sg-api"]},
  "services": [{"service": "api", "container": "api", "repo": "api"},
               {"service": "admin", "container": "admin", "repo": "admin"},
               {"service": "media-worker", "container": "media-worker", "repo": "media-worker"},
               {"service": "media-worker-recording", "container": "media-worker", "repo": "media-worker", "wait": false}]
}'
FIXTURES='{"containers": {"matchup-test-migrate": "migrate", "matchup-test-api": "api", "matchup-test-admin": "admin",
  "matchup-test-media-worker": "media-worker", "matchup-test-media-worker-recording": "media-worker"}}'

TAG=0123456789abcdef0123456789abcdef01234567
pass=0
run() {
  export STATE=$WORK/state-$1; rm -rf "$STATE"; mkdir -p "$STATE"
  echo "$CONFIG" >"$STATE/config.json"; echo "$FIXTURES" >"$STATE/fixtures.json"
  shift
  env PATH="$WORK/bin:$PATH" DEPLOY_POLL_SEC=0 DEPLOY_MIGRATE_TIMEOUT_SEC=5 DEPLOY_STABLE_TIMEOUT_SEC=5 "$@" \
    bash "$SCRIPT" matchup-test "$TAG" >"$STATE/out.log" 2>&1
}
check() {
  if eval "$2"; then pass=$((pass + 1)); echo "PASS: $1"; else echo "FAIL: $1"; echo "--- chiqish:"; cat "$STATE/out.log"; exit 1; fi
}
line_of() { grep -n -m1 -- "$1" "$STATE/calls.log" | cut -d: -f1; }

# 1. Muvaffaqiyatli deploy
run ok || true
check "ok: exit 0" 'grep -q "deploy tugadi" "$STATE/out.log"'
check "ok: migratsiya run-task servislardan oldin" '(( $(line_of "ecs run-task") < $(line_of "ecs update-service") ))'
check "ok: run-task tarmoq sozlamasi" 'grep -q "subnet-a" <(grep "ecs run-task" "$STATE/calls.log") && grep -q "\"assignPublicIp\":\"DISABLED\"" <(grep "ecs run-task" "$STATE/calls.log")'
check "ok: migratsiya image'i = api:<teg>" '[[ $(jq -r ".containerDefinitions[0].image" "$STATE"/td-matchup-test-migrate-*.json) == */matchup-test/api:$TAG ]]'
check "ok: 4 ta servis yangilandi" '[[ $(grep -c "ecs update-service" "$STATE/calls.log") == 4 ]]'
check "ok: recording worker image'i = media-worker:<teg>" '[[ $(jq -r ".containerDefinitions[] | select(.name==\"media-worker\") | .image" "$STATE"/td-matchup-test-media-worker-recording-*.json) == */matchup-test/media-worker:$TAG ]]'
check "ok: boshqa konteyner, env, secret, role'lar o'zgarmagan" 'jq -e ".containerDefinitions[1].image == \"public/sidecar:1\" and .containerDefinitions[0].environment[0].value == \"production\" and .containerDefinitions[0].secrets[0].valueFrom == \"arn:secret\" and .executionRoleArn == \"arn:exec\"" "$STATE"/td-matchup-test-api-*.json >/dev/null'
check "ok: read-only maydonlar olib tashlangan" 'jq -e "has(\"taskDefinitionArn\") or has(\"revision\") or has(\"status\") or has(\"registeredAt\") or has(\"requiresAttributes\") or has(\"compatibilities\") | not" "$STATE"/td-matchup-test-api-*.json >/dev/null'
check "ok: wait=false servis barqarorlik kutishida yo'q" 'grep "ecs describe-services" "$STATE/calls.log" | grep -- "--output json" | grep -vq "media-worker-recording" && grep -q "media-worker-recording.*kutilmaydi" "$STATE/out.log"'
check "ok: SSM teglari (migrate, api, admin, media-worker)" '[[ $(sort "$STATE/ssm.log" | tr "\n" " ") == "/matchup-test/image-tags/admin=$TAG /matchup-test/image-tags/api=$TAG /matchup-test/image-tags/media-worker=$TAG /matchup-test/image-tags/migrate=$TAG " ]]'

# 2. Migratsiya xatosi — servislarga tegilmaydi, log ko'rsatiladi
run migrate-fail MIGRATE_EXIT=1 && exit_code=0 || exit_code=$?
check "migrate-fail: exit != 0" '((exit_code != 0))'
check "migrate-fail: update-service chaqirilmagan" '! grep -q "ecs update-service" "$STATE/calls.log"'
check "migrate-fail: migratsiya logi chiqarilgan" 'grep -q "already exists" "$STATE/out.log" && grep -q "migrate/migrate/migr123" "$STATE/calls.log"'
check "migrate-fail: SSM teglari yozilmagan" '[[ ! -s $STATE/ssm.log ]]'

# 3. Circuit breaker admin'ni orqaga qaytardi — xato, servis teglari yozilmaydi
run rollback ROLLBACK_SERVICE=admin && exit_code=0 || exit_code=$?
check "rollback: exit != 0 va sabab" '((exit_code != 0)) && grep -q "admin: circuit breaker" "$STATE/out.log"'
check "rollback: faqat migrate tegi yozilgan" '[[ $(cat "$STATE/ssm.log") == "/matchup-test/image-tags/migrate=$TAG" ]]'

# 4. ECR'da image yo'q — hech narsa boshlanmaydi
run missing MISSING_REPO=media-worker && exit_code=0 || exit_code=$?
check "missing: exit != 0" '((exit_code != 0)) && grep -q "media-worker:$TAG yo.q" "$STATE/out.log"'
check "missing: run-task va register chaqirilmagan" '! grep -q "ecs run-task\|register-task-definition" "$STATE/calls.log"'

echo "== $pass ta tekshiruv o'tdi"
