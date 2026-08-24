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
        Sid    = "AsgRefresh"
        Effect = "Allow"
        Action = [
          "autoscaling:StartInstanceRefresh",
          "autoscaling:DescribeInstanceRefreshes"
        ]
        # worker 的 ASG 在 05 被 ECS/Fargate service 取代（見 TfWriteEcs），
        # 這裡只剩 API 一個 ASG 還在用這組權限。
        Resource = [
          "arn:aws:autoscaling:ap-northeast-1:461346075470:autoScalingGroup:*:autoScalingGroupName/durable-queue-api"
        ]
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
          "autoscaling:Describe*",
          "rds:Describe*",
          "rds:ListTagsForResource",
          "elasticache:Describe*",
          "elasticache:ListTagsForResource",
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
        Sid    = "TfWriteLaunchTemplate"
        Effect = "Allow"
        Action = [
          "ec2:CreateLaunchTemplateVersion",
          "ec2:ModifyLaunchTemplate"
        ]
        Resource = "*"
      },
      {
        Sid      = "TfPassEc2Role"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::461346075470:role/durable-queue-ec2"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ec2.amazonaws.com"
          }
        }
      },
      {
        # 05：worker.tf 的 task definition 每次 `image_tag` 換值都要註冊新的
        # revision，並讓 service 指過去 —— 這兩件事現在是每次 deploy 都會
        # 觸發的 terraform apply 的一部分，不再只是 launch template 那樣的
        # 例外，所以需要跟 TfWriteLaunchTemplate 同等地位的常態權限。
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
          "ecs:TagResource",
          "ecs:ListTagsForResource"
        ]
        Resource = "*" # ECS 對 task-definition/cluster/service 的讀取類 API 多半不支援資源層級限制
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
      }
    ]
  })
}
