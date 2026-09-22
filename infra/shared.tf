locals {
  # 前端部署在 Vercel，API 的 task definition 與 Worker 的 Lambda 環境都要用到
  frontend_url        = "https://app.loijilai.site"
  google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"

  # Load Model：Worker 不真的轉錄，每份 Job 固定耗時 transcribe_seconds。
  # 24 = 一支 8m34s 影片實測的總處理時間（23.747s）取整，是量到的四個樣本中最
  # 短的一支，不是平均（91.871s）。用最短的樣本是為了讓一次 burst 實驗在幾分
  # 鐘內跑完；代價是結果只能說明容量的形狀，不能換算成平均長度影片下的吞吐。
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
