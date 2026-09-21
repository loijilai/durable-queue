locals {
  # 前端部署在 Vercel，API 的 task definition 與 Worker 的 Lambda 環境都要用到
  frontend_url        = "https://app.loijilai.site"
  google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"

  # Load Model（ADR-0010）。24 = 02 實測 8m34s 影片的總處理時間（23.747s）
  # 取整；偏離 ticket 的「平均值」的理由見
  # issues/scaling-control-loop/11-acceptance-experiment-results.md。
  transcriber        = "fake"
  transcribe_seconds = 24
}


# data 而非 resource：repo 裡放的是所有已部署過的 image，必須活得比這一層久
data "aws_ecr_repository" "registry" {
  name = "durable-queue"
}

data "aws_secretsmanager_secret" "app" {
  name = "durable-queue-app"
}
