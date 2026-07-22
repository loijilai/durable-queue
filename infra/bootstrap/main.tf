# =====================================================================
# Bootstrap：建 terraform remote state 用的 S3 bucket
# ---------------------------------------------------------------------
# 這份 config 用 LOCAL state（就地 terraform.tfstate），只跑一次。
# =====================================================================
terraform {
  required_version = ">= 1.10" # use_lockfile 需要
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

data "aws_caller_identity" "current" {}

# bucket 名字全球唯一：用 account id 當後綴避免撞名
resource "aws_s3_bucket" "tfstate" {
  bucket = "durable-queue-tfstate-${data.aws_caller_identity.current.account_id}"

  # 學習環境：允許 destroy 時連同內容一起刪。正式環境不要開。
  force_destroy = true
}

# ── versioning：state bucket 必開 ────────────────────────────────────
# 每次 apply 都覆寫 state 檔；有 versioning 才能在寫壞時回滾到前一版。
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ── 加密（state 裡有 secret arn、endpoint 等敏感資訊）────────────────
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── 徹底擋掉公開存取 ─────────────────────────────────────────────────
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

# App Secret ——長存，跨主 stack 的 apply/destroy 不重灌
resource "aws_secretsmanager_secret" "app" {
  name                    = "durable-queue-app"
  recovery_window_in_days = 0 # 學習環境；bootstrap destroy 時可即刻刪
}
