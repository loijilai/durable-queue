# =====================================================================
# GitHub Actions → AWS 的 OIDC 信任
# ---------------------------------------------------------------------
# 目的：讓 CD workflow 不靠長期 access key，改成每次 job 臨時跟 AWS
#       換一把幾分鐘就過期的 credentials。
# =====================================================================

# ── OIDC Identity Provider（一個 AWS 帳號建一次）───────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

# ── IAM Role + trust policy────────────
resource "aws_iam_role" "github_actions" {
  name = "durable-queue-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # ★ 鎖到 repo + master branch，別放寬成 repo:owner/repo:*
          "token.actions.githubusercontent.com:sub" = "repo:loijilai/durable-queue:ref:refs/heads/master"
        }
      }
    }]
  })
}

# =====================================================================
# Permission policy：這個 role 能做什麼
# =====================================================================
resource "aws_iam_role_policy" "github_actions" {
  name = "durable-queue-cd"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ── (a) ECR：build 完 push image ──────────────────────────────
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*" # GetAuthorizationToken 不支援 resource 限定
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          # apply 時 terraform 可能要讀 image，順帶給讀
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = aws_ecr_repository.registry.arn
      },

      # ── (c) ASG：滾動更新 ─────────────────────────────────────────
      {
        Sid    = "AsgRefresh"
        Effect = "Allow"
        Action = [
          "autoscaling:StartInstanceRefresh",
          "autoscaling:DescribeInstanceRefreshes"
        ]
        Resource = [
          aws_autoscaling_group.api.arn,
          aws_autoscaling_group.worker.arn
        ]
      },

      # ── (b-1) terraform S3 backend：讀寫 state + lock ─────────────
      {
        Sid    = "TfStateList"
        Effect = "Allow"
        Action = "s3:ListBucket"
        # bootstrap 建的 state bucket；ARN 這裡跟 backend.tf 一致
        Resource = "arn:aws:s3:::durable-queue-tfstate-461346075470"
      },
      {
        Sid    = "TfStateObject"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject" # use_lockfile 的 .tflock 檔要能刪
        ]
        Resource = "arn:aws:s3:::durable-queue-tfstate-461346075470/durable-queue/*"
      },

      # ── (b-2) terraform apply：讀全部（refresh 對帳用）────────────
      # apply 每次都先 refresh 全資源，需要跨 service 的唯讀權限。
      # Describe*/Get*/List* 多半不支援 resource 限定，故 Resource = "*"。
      {
        Sid    = "TfRefreshRead"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "autoscaling:Describe*",
          "rds:Describe*",
          "elasticache:Describe*",
          "elasticloadbalancing:Describe*",
          "route53:Get*",
          "route53:List*",
          "acm:Describe*",
          "acm:List*",
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "ecr:Describe*",
          "iam:Get*",
          "iam:List*"
        ]
        Resource = "*"
      },

      # ── (b-2) terraform apply：CD 真正會改的只有 launch template ──
      {
        Sid    = "TfWriteLaunchTemplate"
        Effect = "Allow"
        Action = [
          "ec2:CreateLaunchTemplateVersion",
          "ec2:ModifyLaunchTemplate"
        ]
        Resource = "*"
      },

      # ── (b-2) PassRole：改 LT 時要能「傳遞」instance profile 的 role ─
      {
        Sid      = "TfPassEc2Role"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.ec2.arn
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ec2.amazonaws.com"
          }
        }
      }
    ]
  })
}
