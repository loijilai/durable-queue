# =====================================================================
# Remote state 後端：S3（含原生 lock）
# =====================================================================
terraform {
  backend "s3" {
    bucket       = "durable-queue-tfstate-461346075470"
    key          = "durable-queue/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true # S3 原生 lock，免 DynamoDB
  }
}
