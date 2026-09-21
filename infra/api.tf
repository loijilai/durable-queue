# =====================================================================
# API：ECS/Fargate service
# ---------------------------------------------------------------------
# 取代原本「開一台 EC2、跑 user_data.sh 裡的 gunicorn」的 launch template
# + ASG。這次遷移純粹是簡化 —— 部署方式從「開機腳本」換成宣告式的 task
# definition，跟 Worker 在 05 做的事是同一個設計換一層抽象重新表達，兩者
# 共用同一份 image，只有啟動指令不同。
#
# 容量固定，不設 scaling policy：沒有量測指出需要它。
# =====================================================================

# cluster 裡只剩 API 與一次性的 migrate task——Worker 是 Lambda（worker.tf）。
# Container Insights 關閉：它唯一的讀者是舊 dashboard 的 RunningTaskCount，
# 用來數 Worker，現在 Worker 數量由 Lambda 自己的 ConcurrentExecutions 提供。
resource "aws_ecs_cluster" "main" {
  name = "durable-queue"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

locals {
  # API 沒有 02 那樣的量測依據，選 Fargate 上可用的最小檔位之上一階：
  # 0.5 vCPU / 1GiB，比原本 t3.micro（2 vCPU 突發 / 1GiB，OS 常駐吃掉一截）
  # 寬裕。容量固定、沒有 scaling policy，量不夠的話由後續觀測決定要不要調。
  api_cpu    = "512"
  api_memory = "1024"

  # API 和 Worker 共用同一份 Django settings.py，需要的環境變數集合完全
  # 相同（見 scripts/check_env_parity.py 的說明）。這裡跟 worker.tf 的
  # Lambda 環境手動保持一致，對帳只盯著 worker.tf 那一份。
  app_environment = [
    { name = "POSTGRES_DB", value = aws_db_instance.postgres.db_name },
    { name = "POSTGRES_USER", value = aws_db_instance.postgres.username },
    { name = "POSTGRES_HOST", value = aws_db_instance.postgres.address },
    { name = "POSTGRES_PORT", value = tostring(aws_db_instance.postgres.port) },
    { name = "JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
    { name = "TRANSCRIBER", value = local.transcriber },
    { name = "TRANSCRIBE_SECONDS", value = tostring(local.transcribe_seconds) },
    { name = "GOOGLE_REDIRECT_URI", value = local.google_redirect_uri },
    { name = "FRONTEND_URL", value = local.frontend_url },
    { name = "CORS_ALLOWED_ORIGINS", value = local.frontend_url },
    { name = "DEBUG", value = "False" }
  ]

  app_secrets = [
    { name = "POSTGRES_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
    { name = "SECRET_KEY", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:secret_key::" },
    { name = "GOOGLE_CLIENT_ID", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:google_client_id::" },
    { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:google_client_secret::" }
  ]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/durable-queue-api"
  retention_in_days = 14
}


# ── Execution role：ECS agent 用它 pull image、寫 CloudWatch Logs、在容器
#    啟動時解析 `secrets` 欄位指向的 Secrets Manager 值 ─────────────────
resource "aws_iam_role" "api_execution" {
  name = "durable-queue-api-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_execution" {
  role       = aws_iam_role.api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "api_execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.api_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "secretsmanager:GetSecretValue"
      Resource = [
        data.aws_secretsmanager_secret.app.arn,
        aws_db_instance.postgres.master_user_secret[0].secret_arn
      ]
    }]
  })
}


# ── Task role：API 透過 jobs.queue.enqueue_job() 送出 Job，只准對 Job 佇列
#    發布訊息。boto3 拿著完整的佇列 URL 呼叫 SendMessage，不需要先解析名稱，
#    所以沒有 GetQueueUrl / GetQueueAttributes / ListQueues；也沒有
#    Receive/Delete/ChangeVisibility——那是 Worker 的權限，API 從不消費自己
#    送出的訊息 ────────────────────────────────────────────────────────
resource "aws_iam_role" "api_task" {
  name = "durable-queue-api-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_task_sqs" {
  name = "publish-to-job-queue"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.jobs.arn
    }]
  })
}


# =====================================================================
# Task definition
# =====================================================================
resource "aws_ecs_task_definition" "api" {
  family                   = "durable-queue-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.api_cpu
  memory                   = local.api_memory
  execution_role_arn       = aws_iam_role.api_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${data.aws_ecr_repository.registry.repository_url}:${var.image_tag}"
      essential = true
      command   = ["gunicorn", "durable_queue.wsgi:application", "--bind", "0.0.0.0:8000", "--access-logfile", "-"]

      portMappings = [
        { containerPort = 8000, protocol = "tcp" }
      ]

      environment = local.app_environment
      secrets     = local.app_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = "ap-northeast-1"
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "durable-queue-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"

  # 固定容量，對應原本 API ASG 的 min=max=desired=2。不設 scaling policy——
  # 沒有量測指出需要它。
  desired_count = 2

  # 09：滾動更新的零停機保證。min=100% 代表更新過程中，「先前版本」的
  # 健康任務數不得低於 desired_count——新任務要先過 health check 才能
  # 讓舊任務下線。max=200% 允許新舊任務短暫並存，讓 min=100% 有空間達成。
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = [for subnet in aws_subnet.private : subnet.id]
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }

  health_check_grace_period_seconds = 60

  depends_on = [aws_lb_listener.https]

  # 與 Worker 的 image_uri 同一個理由（見 worker.tf）：apply 只註冊新的 task
  # definition revision，不讓 service 換上去。否則 apply 會在 migrate task 之前
  # 就開始滾動更新，新版 API 可能對著舊 schema 服務；部署流程的第二次
  # update-service 也會讓滾動更新做兩輪。service 換到新 revision 只發生在部署
  # 流程的 Deploy API service（ci-cd.yml 與 deploy.sh），順序在 migrate 之後。
  #
  # 代價與 Worker 相同：Terraform 不再收斂 API 跑的是哪個 revision，`terraform
  # apply` 也不能用來回退它。
  lifecycle {
    ignore_changes = [task_definition]
  }
}


# =====================================================================
# 資料庫遷移：獨立的一次性 task
# ---------------------------------------------------------------------
# 修正既有的競爭條件：原本 migrate 塞在 API 的啟動指令裡，多個實例／滾動
# 部署可能同時跑 migrate。這裡只註冊 task definition，不建 service——由
# 部署流程在更新 API service 與 Lambda function 之前，明確跑一次
# `aws ecs run-task` 並等它跑完。
# =====================================================================
resource "aws_ecs_task_definition" "migrate" {
  family                   = "durable-queue-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.api_cpu
  memory                   = local.api_memory
  execution_role_arn       = aws_iam_role.api_execution.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${data.aws_ecr_repository.registry.repository_url}:${var.image_tag}"
      essential = true
      command   = ["python", "manage.py", "migrate"]

      environment = local.app_environment
      secrets     = local.app_secrets

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = "ap-northeast-1"
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}
