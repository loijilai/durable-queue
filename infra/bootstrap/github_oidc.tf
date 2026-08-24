resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

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
          "token.actions.githubusercontent.com:sub" = "repo:loijilai/durable-queue:ref:refs/heads/*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "durable-queue-cd"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
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
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = "arn:aws:ecr:ap-northeast-1:461346075470:repository/durable-queue"
      },
      {
        Sid      = "TfStateList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::durable-queue-tfstate-461346075470"
      },
      {
        Sid    = "TfStateObject"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "arn:aws:s3:::durable-queue-tfstate-461346075470/durable-queue/*"
      },
      {
        Sid    = "TfRefreshRead"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "rds:Describe*",
          "rds:ListTagsForResource",
          "elasticloadbalancing:Describe*",
          "route53:Get*",
          "route53:List*",
          "acm:Describe*",
          "acm:List*",
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:GetResourcePolicy",
          "ecr:Describe*",
          "ecr:ListTagsForResource",
          "ssm:GetParameter",
          "iam:Get*",
          "iam:List*"
        ]
        Resource = "*"
      },
      {
        # 05 把 worker、06 把 API 都換成 ECS/Fargate：task definition 每次
        # `image_tag` 換值都要註冊新的 revision、讓 service 指過去，這是每次
        # deploy 都會觸發的 terraform apply 的一部分，是常態權限。RunTask /
        # DescribeTasks 給部署流程執行一次性的資料庫遷移 task 並等它跑完用。
        Sid    = "TfWriteEcs"
        Effect = "Allow"
        Action = [
          "ecs:CreateCluster",
          "ecs:DeleteCluster",
          "ecs:DescribeClusters",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:CreateService",
          "ecs:DeleteService",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:TagResource",
          "ecs:ListTagsForResource"
        ]
        Resource = "*" # ECS 對 task-definition/cluster/service/task 的讀取類 API 多半不支援資源層級限制
      },
      {
        Sid    = "TfWriteQueue"
        Effect = "Allow"
        Action = [
          "sqs:CreateQueue",
          "sqs:DeleteQueue",
          "sqs:GetQueueAttributes",
          "sqs:SetQueueAttributes",
          "sqs:TagQueue",
          "sqs:ListQueueTags"
        ]
        Resource = [
          "arn:aws:sqs:ap-northeast-1:461346075470:celery",
          "arn:aws:sqs:ap-northeast-1:461346075470:celery-dlq"
        ]
      },
      {
        Sid    = "TfWriteWorkerLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "logs:DescribeLogGroups",
          "logs:ListTagsForResource",
          "logs:TagResource"
        ]
        Resource = "arn:aws:logs:ap-northeast-1:461346075470:log-group:/ecs/durable-queue-worker*"
      },
      {
        Sid    = "TfWriteWorkerRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:TagRole"
        ]
        Resource = [
          "arn:aws:iam::461346075470:role/durable-queue-worker-execution",
          "arn:aws:iam::461346075470:role/durable-queue-worker-task"
        ]
      },
      {
        Sid    = "TfPassWorkerRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::461346075470:role/durable-queue-worker-execution",
          "arn:aws:iam::461346075470:role/durable-queue-worker-task"
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      },
      {
        # 06：API 也搬上 Fargate，跟 TfWriteWorkerLogGroup 同構。
        Sid    = "TfWriteApiLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "logs:DescribeLogGroups",
          "logs:ListTagsForResource",
          "logs:TagResource"
        ]
        Resource = "arn:aws:logs:ap-northeast-1:461346075470:log-group:/ecs/durable-queue-api*"
      },
      {
        Sid    = "TfWriteApiRoles"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:TagRole"
        ]
        Resource = [
          "arn:aws:iam::461346075470:role/durable-queue-api-execution",
          "arn:aws:iam::461346075470:role/durable-queue-api-task"
        ]
      },
      {
        # migrate task 重用 api-execution role，不需要額外的 PassRole 條目。
        Sid    = "TfPassApiRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::461346075470:role/durable-queue-api-execution",
          "arn:aws:iam::461346075470:role/durable-queue-api-task"
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      }
    ]
  })
}
