locals {
  # 前端部署在 Vercel, api 和 worker 的 task definition 都要用到
  frontend_url              = "https://app.loijilai.site"
  google_redirect_uri       = "https://durable-queue.loijilai.site/api/auth/google/callback/"
  transcriber               = "fake"
  transcribe_seconds        = 1
  celery_visibility_timeout = 3600

  # SQS 取代 Redis：不帶 host/port，靠 IAM role（ECS task role）的預設憑證鏈
  # 解析佇列，佇列名稱固定為 "celery"（見 queue.tf）。API 和 Worker 共用同一個
  # 值 —— 兩邊必須連到同一個佇列。
  celery_broker_url = "sqs://"
}


# =====================================================================
# Amazon Elastic Container Registry
# ---------------------------------------------------------------------
# data 而非 resource：repo 裡放的是所有已部署過的 image（tag = commit sha），
# 必須活得比這一層久
data "aws_ecr_repository" "registry" {
  name = "durable-queue"
}

# =====================================================================
# App Secrets
# ---------------------------------------------------------------------
data "aws_secretsmanager_secret" "app" {
  name = "durable-queue-app"
}
