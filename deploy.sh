#!/usr/bin/env bash
# =====================================================================
# deploy.sh — 一鍵部署：terraform apply → build+push → 灌 secret → 滾 ASG
# ---------------------------------------------------------------------
# 首批 instance 若因 image/secret 未就緒而開機失敗，
# 最後的 instance refresh 會用已 push 的 image + 已灌的 secret 換成正常的。
# =====================================================================
set -euo pipefail

REGION="ap-northeast-1"
ECR_REPO="durable-queue"
APP_SECRET_ID="durable-queue-app"
ASGS=("durable-queue-api" "durable-queue-worker")

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

# ── 4. 滾動 ASG（新 instance 重跑 user_data → pull 新 image + 讀 secret）
for asg in "${ASGS[@]}"; do
  aws autoscaling start-instance-refresh --region "$REGION" \
    --auto-scaling-group-name "$asg" \
    --preferences '{"MinHealthyPercentage":0}' >/dev/null
done

echo "✓ done."
