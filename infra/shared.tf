locals {
  # 前端部署在 Vercel, api 和 worker 的 task definition 都要用到
  frontend_url        = "https://app.loijilai.site"
  google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"

  # Load Model（ADR-0010）。24 = 02 實測 8m34s 影片的總處理時間（23.747s）
  # 取整；偏離 ticket 的「平均值」的理由見
  # issues/scaling-control-loop/11-acceptance-experiment-results.md。
  transcriber        = "fake"
  transcribe_seconds = 24

  # 02 投影的 Admission Limit 下最長 Execution Time 352.1s × 安全係數 2。
  celery_visibility_timeout = 720

  # 不帶 host/port，靠 task role 解析佇列；名稱固定為 "celery"（queue.tf）。
  celery_broker_url = "sqs://"
}


# data 而非 resource：repo 裡放的是所有已部署過的 image，必須活得比這一層久
data "aws_ecr_repository" "registry" {
  name = "durable-queue"
}

data "aws_secretsmanager_secret" "app" {
  name = "durable-queue-app"
}
