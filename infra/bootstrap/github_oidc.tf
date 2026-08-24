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
        # ci-cd.yml 的 deploy job 掛了 `environment: production`：一旦 job 綁定
        # environment，GitHub 簽發的 OIDC token 的 sub claim 會變成
        # `repo:OWNER/REPO:environment:NAME`，不再是 `ref:refs/heads/*`。只允許
        # 後者會讓 AssumeRoleWithWebIdentity 在核准 production 部署後才發現被拒絕。
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:loijilai/durable-queue:ref:refs/heads/*",
            "repo:loijilai/durable-queue:environment:production"
          ]
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
          "iam:List*",
          # logs:DescribeLogGroups 是帳號層級的列出型 API，不接受
          # resource-level 限制（曾實測：綁定單一 log-group ARN 一樣被拒），
          # 只能放這裡跟其他 Describe* 一起用 Resource = "*"。
          "logs:DescribeLogGroups"
        ]
        Resource = "*"
      },
      {
        # 這個帳號裡 network.tf / alb.tf / acm.tf / route53.tf / database.tf
        # 宣告的 VPC、ALB、ACM 憑證、RDS 從未被真的 apply 過一次——CD role
        # 原本只有 Describe，這裡補上把整套基礎網路 + 邊界資源「從零建出來」
        # 所需的建立/修改/刪除權限，讓 CI 能一次跑完 terraform apply，不用
        # 另外用本機身分先手動 bootstrap 一次。
        Sid    = "TfWriteFoundationalInfra"
        Effect = "Allow"
        Action = [
          # VPC / 子網路 / 路由 / 網路閘道
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet",
          "ec2:DeleteSubnet",
          "ec2:ModifySubnetAttribute",
          "ec2:CreateInternetGateway",
          "ec2:DeleteInternetGateway",
          "ec2:AttachInternetGateway",
          "ec2:DetachInternetGateway",
          "ec2:CreateNatGateway",
          "ec2:DeleteNatGateway",
          "ec2:AllocateAddress",
          "ec2:ReleaseAddress",
          "ec2:AssociateAddress",
          "ec2:DisassociateAddress",
          "ec2:CreateRouteTable",
          "ec2:DeleteRouteTable",
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
          "ec2:ReplaceRoute",
          "ec2:AssociateRouteTable",
          "ec2:DisassociateRouteTable",
          "ec2:ReplaceRouteTableAssociation",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          # Security group：建立/刪除群組本身，以及群組上掛的 ingress/egress rule
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:ModifySecurityGroupRules",
          "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
          "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          # ALB：load balancer / target group / listener
          "elasticloadbalancing:CreateLoadBalancer",
          "elasticloadbalancing:DeleteLoadBalancer",
          "elasticloadbalancing:ModifyLoadBalancerAttributes",
          "elasticloadbalancing:SetSecurityGroups",
          "elasticloadbalancing:SetSubnets",
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:ModifyTargetGroup",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:CreateListener",
          "elasticloadbalancing:DeleteListener",
          "elasticloadbalancing:ModifyListener",
          "elasticloadbalancing:AddTags",
          "elasticloadbalancing:RemoveTags",
          # ACM：申請憑證、DNS 驗證、換新
          "acm:RequestCertificate",
          "acm:DeleteCertificate",
          "acm:AddTagsToCertificate",
          "acm:RemoveTagsFromCertificate",
          "acm:RenewCertificate",
          "acm:UpdateCertificateOptions",
          # Route53：ACM 驗證用的 CNAME + app 的 alias A record
          "route53:ChangeResourceRecordSets",
          "route53:GetChange",
          # RDS：instance + subnet group
          "rds:CreateDBInstance",
          "rds:DeleteDBInstance",
          "rds:ModifyDBInstance",
          "rds:CreateDBSubnetGroup",
          "rds:DeleteDBSubnetGroup",
          "rds:ModifyDBSubnetGroup",
          "rds:AddTagsToResource",
          "rds:RemoveTagsFromResource"
        ]
        Resource = "*" # 這些服務的建立類 API 大多不支援有意義的 resource-level 限制（建立當下還沒有 ARN 可綁）
      },
      {
        # ALB/RDS 在這個帳號是第一次真的建立：兩者都會讓 AWS 視需要自動建立
        # service-linked role（AWSServiceRoleForElasticLoadBalancing /
        # AWSServiceRoleForRDS）。如果帳號裡已經存在就是 no-op，不存在的話
        # 沒有這個權限 apply 會直接卡住。
        Sid      = "TfCreateServiceLinkedRoles"
        Effect   = "Allow"
        Action   = "iam:CreateServiceLinkedRole"
        Resource = "*"
        Condition = {
          StringEquals = {
            "iam:AWSServiceName" = [
              "elasticloadbalancing.amazonaws.com",
              "rds.amazonaws.com"
            ]
          }
        }
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
        # DescribeLogGroups 不放這裡——它是帳號層級 API，見上面 TfRefreshRead
        # 的註解，已經用 Resource = "*" 開放過了。
        Sid    = "TfWriteWorkerLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
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
