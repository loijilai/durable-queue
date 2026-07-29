# =====================================================================
# Remote state 後端：S3
# ---------------------------------------------------------------------
# 搬離 local state，避免 state 檔跟著 working directory 一起
# =====================================================================
terraform {
  backend "s3" {
    bucket       = "durable-queue-tfstate-461346075470"
    key          = "durable-queue/dns.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
