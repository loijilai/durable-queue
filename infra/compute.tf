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
          aws_secretsmanager_secret.app.arn,
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
        Resource = aws_ecr_repository.registry.arn
      }
    ]
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
    registry      = split("/", aws_ecr_repository.registry.repository_url)[0]
    image         = "${aws_ecr_repository.registry.repository_url}:latest"
    db_secret_id  = aws_db_instance.postgres.master_user_secret[0].secret_arn
    app_secret_id = aws_secretsmanager_secret.app.arn

    # ── 非機密、Terraform 注入的 endpoint / config ──
    db_name = aws_db_instance.postgres.db_name
    db_user = aws_db_instance.postgres.username
    db_host = aws_db_instance.postgres.address
    db_port = aws_db_instance.postgres.port
    celery_broker_url = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379/0"
    celery_result_backend = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379/1"
    google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"
    run_command = "sh -c \"python manage.py migrate && gunicorn durable_queue.wsgi:application --bind 0.0.0.0:8000 --access-logfile -\""
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "durable-queue-api" }
  }
}

# ── worker ───────────────────────────────────────────────────────────
resource "aws_launch_template" "worker" {
  name     = "durable-queue-worker"
  image_id = data.aws_ssm_parameter.al2023_ami.value
  instance_type = "t3.micro"

  iam_instance_profile {
    name = aws_iam_instance_profile.ec2.name
  }

  vpc_security_group_ids = [aws_security_group.worker.id]

  # user_data：同一份模板，只有 run_command 換成 celery。
  user_data = base64encode(templatefile("${path.module}/user_data.sh.tftpl", {
    region        = "ap-northeast-1"
    registry      = split("/", aws_ecr_repository.registry.repository_url)[0]
    image         = "${aws_ecr_repository.registry.repository_url}:latest"
    db_secret_id  = aws_db_instance.postgres.master_user_secret[0].secret_arn
    app_secret_id = aws_secretsmanager_secret.app.arn

    # ── 非機密、Terraform 注入的 endpoint / config ──
    db_name = aws_db_instance.postgres.db_name
    db_user = aws_db_instance.postgres.username
    db_host = aws_db_instance.postgres.address
    db_port = aws_db_instance.postgres.port
    celery_broker_url = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379/0"
    celery_result_backend = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379/1"
    google_redirect_uri = "https://durable-queue.loijilai.site/api/auth/google/callback/"
    run_command = "celery -A durable_queue worker -l info"
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "durable-queue-worker" }
  }
}


# =====================================================================
# ASG ×2（api / worker）
# ---------------------------------------------------------------------
# 跨 2 AZ 的 private subnet 分散；每個 ASG 綁自己的 launch template。
# =====================================================================

# ── api ──────────────────────────────────────────────────────────────
resource "aws_autoscaling_group" "api" {
  name = "durable-queue-api"

  # 跨 AZ 分散到兩個 private subnet
  vpc_zone_identifier = [for subnet in aws_subnet.private : subnet.id]

  # HA
  min_size = 2
  max_size = 2
  desired_capacity = 2

  launch_template {
    id      = aws_launch_template.api.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.api.arn]

  tag {
    key                 = "Name"
    value               = "durable-queue-api"
    propagate_at_launch = true
  }
}

# ── worker ───────────────────────────────────────────────────────────
resource "aws_autoscaling_group" "worker" {
  name = "durable-queue-worker"

  vpc_zone_identifier = [for subnet in aws_subnet.private : subnet.id]

  # HA
  min_size = 2
  max_size = 2
  desired_capacity = 2

  launch_template {
    id      = aws_launch_template.worker.id
    version = "$Latest"
  }

  # worker 不接流量，沒有 target group。

  tag {
    key                 = "Name"
    value               = "durable-queue-worker"
    propagate_at_launch = true
  }
}

# =====================================================================
# Amazon Elastic Container Registry
# ---------------------------------------------------------------------
resource "aws_ecr_repository" "registry" {
  name = "durable-queue"
  force_delete = true # build-and-destroy 學習環境
  tags = { Name = "durable-queue-ecr" }
}

# =====================================================================
# App Secrets
# ---------------------------------------------------------------------
resource "aws_secretsmanager_secret" "app" {
  name = "durable-queue-app"
  recovery_window_in_days = 0 # build-and-destroy 學習環境
}