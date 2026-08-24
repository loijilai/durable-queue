locals {
  # 前端部署在 Vercel, api 這個 launch template 和 worker 的 task definition 都要用到
  frontend_url              = "https://app.loijilai.site"
  google_redirect_uri       = "https://durable-queue.loijilai.site/api/auth/google/callback/"
  transcriber               = "fake"
  transcribe_seconds        = 1
  celery_visibility_timeout = 3600

  # SQS 取代 Redis：不帶 host/port，靠 IAM role（EC2 instance profile /
  # ECS task role）的預設憑證鏈解析佇列，佇列名稱固定為 "celery"（見
  # queue.tf）。API 和 Worker 共用同一個值 —— 兩邊必須連到同一個佇列。
  celery_broker_url = "sqs://"
}


# ── Trust policy: 信任 EC2 service 來扮演 role ───────────────────────────────────
resource "aws_iam_role" "ec2" {
  name = "durable-queue-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# ── Permission policy：只准讀那一個 RDS managed secret（最小權限）──────────────
resource "aws_iam_role_policy" "read_db_secret" {
  name = "read-db-secret"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          data.aws_secretsmanager_secret.app.arn,
          aws_db_instance.postgres.master_user_secret[0].secret_arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage"
        ]
        Resource = data.aws_ecr_repository.registry.arn
      }
    ]
  })
}

# ── Permission policy：API 透過 tasks.execute_job.delay() 送出 Job，
#    只准對 celery 這一個佇列發布訊息（不含 Receive/Delete/ChangeVisibility
#    —— 那是 Worker 的權限，API 從不消費自己送出的訊息）──────────────
resource "aws_iam_role_policy" "publish_to_celery_queue" {
  name = "publish-to-celery-queue"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:GetQueueUrl",
        "sqs:SendMessage"
      ]
      Resource = aws_sqs_queue.celery.arn
    }]
  })
}

# ── AWS managed policy：讓 EC2 上的 SSM Agent 使用 SSM ─────────
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ── instance profile：包住 role，launch template 掛的是這個（不是 role）──
resource "aws_iam_instance_profile" "ec2" {
  name = "durable-queue-ec2"
  role = aws_iam_role.ec2.name
}


# =====================================================================
# AMI：用 data source 動態查最新的 Amazon Linux 2023
# =====================================================================
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}


# =====================================================================
# Launch Template ×2（api / worker）
# ---------------------------------------------------------------------
# 差異只在：掛哪個 SG、user_data 跑哪個 process。
# =====================================================================

# ── api ──────────────────────────────────────────────────────────────
resource "aws_launch_template" "api" {
  name          = "durable-queue-api"
  image_id      = data.aws_ssm_parameter.al2023_ami.value
  instance_type = "t3.micro"

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  vpc_security_group_ids = [aws_security_group.api.id]

  # user_data：共用模板，用 templatefile 傳入 api 專屬參數。
  user_data = base64encode(templatefile("${path.module}/user_data.sh.tftpl", {
    region        = "ap-northeast-1"
    registry      = split("/", data.aws_ecr_repository.registry.repository_url)[0]
    image         = "${data.aws_ecr_repository.registry.repository_url}:${var.image_tag}"
    db_secret_id  = aws_db_instance.postgres.master_user_secret[0].secret_arn
    app_secret_id = data.aws_secretsmanager_secret.app.arn

    # ── 非機密、Terraform 注入的 endpoint / config ──
    db_name                   = aws_db_instance.postgres.db_name
    db_user                   = aws_db_instance.postgres.username
    db_host                   = aws_db_instance.postgres.address
    db_port                   = aws_db_instance.postgres.port
    celery_broker_url         = local.celery_broker_url
    celery_visibility_timeout = local.celery_visibility_timeout
    transcriber               = local.transcriber
    transcribe_seconds        = local.transcribe_seconds
    google_redirect_uri       = local.google_redirect_uri
    frontend_url              = local.frontend_url
    run_command               = "sh -c \"python manage.py migrate && gunicorn durable_queue.wsgi:application --bind 0.0.0.0:8000 --access-logfile -\""
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "durable-queue-api" }
  }
}

# worker 已不再是 launch template + ASG，見 worker.tf 的 ECS/Fargate service。

# =====================================================================
# ASG（api）
# ---------------------------------------------------------------------
# 跨 2 AZ 的 private subnet 分散。
# =====================================================================

# ── api ──────────────────────────────────────────────────────────────
resource "aws_autoscaling_group" "api" {
  name = "durable-queue-api"

  # 跨 AZ 分散到兩個 private subnet
  vpc_zone_identifier = [for subnet in aws_subnet.private : subnet.id]

  # HA
  min_size         = 2
  max_size         = 2
  desired_capacity = 2

  launch_template {
    id      = aws_launch_template.api.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.api.arn]

  health_check_type         = "ELB"
  health_check_grace_period = 300

  tag {
    key                 = "Name"
    value               = "durable-queue-api"
    propagate_at_launch = true
  }
}

# =====================================================================
# Amazon Elastic Container Registry
# ---------------------------------------------------------------------
# data 而非 resource：repo 裡放的是所有已部署過的 image（tag = commit sha），
# 必須活得比這一層久
data "aws_ecr_repository" "registry" {
  name = "durable-queue"
}

# =====================================================================
# App Secrets
# ---------------------------------------------------------------------
data "aws_secretsmanager_secret" "app" {
  name = "durable-queue-app"
}