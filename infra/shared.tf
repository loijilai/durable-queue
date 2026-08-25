locals {
  # 前端部署在 Vercel, api 和 worker 的 task definition 都要用到
  frontend_url        = "https://app.loijilai.site"
  google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"
  transcriber         = "fake"
  transcribe_seconds  = 1

  # 從 02 的量測推導，不是選定的常數：Admission Limit（14400s）下 02 的
  # 迴歸模型投影 Execution Time ≈ 352.1s（issues/scaling-control-loop/
  # 02-measure-execution-time-results.md）。乘上安全係數 2 覆蓋兩件事：
  # (1) 該投影超出實際取樣範圍（樣本最長 2h08m，Admission Limit 是 4h）；
  # (2) transcribers.py 對每個音訊分段的 in-process 重試（最多 3 次，
  # backoff 最長 10s）帶來的額外耗時。352.1 × 2 = 704.2，取整到 720（12
  # 分鐘）。完整推導見 issues/scaling-control-loop/07-scaling-policy-
  # derivations.md。
  celery_visibility_timeout = 720

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
