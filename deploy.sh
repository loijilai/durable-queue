#!/usr/bin/env bash
# =====================================================================
# deploy.sh — 一鍵部署：terraform apply → build+push → 灌 secret →
#             跑一次性 migrate task → 滾 api service → 更新 worker function
# =====================================================================
set -euo pipefail

REGION="ap-northeast-1"
ECR_REPO="durable-queue"
APP_SECRET_ID="durable-queue-app"
ECS_CLUSTER="durable-queue"
WORKER_FUNCTION="durable-queue-worker"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT="${ROOT}/durable_queue"
ENV_FILE="${BUILD_CONTEXT}/.env"

# ── 1. terraform apply（建/更新全部基礎設施，含 ECR repo + secret 空殼）─
terraform -chdir="${ROOT}/infra" apply

# ── 2. build amd64 + push ─────────────────────────────────────────────
ECR_URI="$(aws ecr describe-repositories --repository-names "$ECR_REPO" \
  --region "$REGION" --query 'repositories[0].repositoryUri' --output text)"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ECR_URI%%/*}"
docker buildx build --platform linux/amd64 -t "${ECR_URI}:latest" \
  -f "${BUILD_CONTEXT}/Dockerfile" "$BUILD_CONTEXT" --push

# ── 3. 灌 app secret（從 .env 讀，plaintext 不進 tf/tfstate）───────────
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
aws secretsmanager put-secret-value --region "$REGION" --secret-id "$APP_SECRET_ID" \
  --secret-string "$(jq -n \
    --arg sk  "$(get_env SECRET_KEY)" \
    --arg cid "$(get_env GOOGLE_CLIENT_ID)" \
    --arg cs  "$(get_env GOOGLE_CLIENT_SECRET)" \
    '{secret_key: $sk, google_client_id: $cid, google_client_secret: $cs}')" >/dev/null

# ── 4. 資料庫遷移：獨立的一次性 task，跑在部署 api/worker 之前 ────────────
SUBNETS_JSON="$(terraform -chdir="${ROOT}/infra" output -json private_subnet_ids)"
SECURITY_GROUP="$(terraform -chdir="${ROOT}/infra" output -raw api_security_group_id)"

TASK_ARN="$(aws ecs run-task --region "$REGION" --cluster "$ECS_CLUSTER" \
  --task-definition durable-queue-migrate --launch-type FARGATE \
  --network-configuration "{\"awsvpcConfiguration\":{\"subnets\":$SUBNETS_JSON,\"securityGroups\":[\"$SECURITY_GROUP\"],\"assignPublicIp\":\"DISABLED\"}}" \
  --query 'tasks[0].taskArn' --output text)"

aws ecs wait tasks-stopped --region "$REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
[ "$EXIT_CODE" = "0" ] || { echo "Migration task failed (exit code $EXIT_CODE)" >&2; exit 1; }

# ── 5. 讓 api service 換到 apply 註冊的最新 task definition revision
#       （service 忽略 task_definition 的漂移，見 infra/api.tf 的 lifecycle）──
aws ecs update-service --region "$REGION" \
  --cluster "$ECS_CLUSTER" --service durable-queue-api \
  --task-definition durable-queue-api >/dev/null

# ── 6. Worker 是 Lambda：image_uri 的漂移由 Terraform 忽略，程式碼只在這裡
#       更新（見 infra/worker.tf 的 lifecycle），順序在 migrate 之後 ────────
aws lambda update-function-code --region "$REGION" \
  --function-name "$WORKER_FUNCTION" --image-uri "${ECR_URI}:latest" >/dev/null

aws lambda wait function-updated --region "$REGION" \
  --function-name "$WORKER_FUNCTION"

echo "✓ done."
