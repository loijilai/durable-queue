# =====================================================================
# Worker：ECS/Fargate service
# ---------------------------------------------------------------------
# 取代原本「開一台 EC2、跑 user_data.sh 裡的 celery worker」的 launch
# template + ASG。API 仍留在 EC2 上（06 才動它）—— 這個混合狀態是刻意的。
#
# 容量由 07（worker_autoscaling.tf）的 step scaling policy 驅動；這裡只
# 宣告 service 本身，desired_count 的初始值等於 scaling policy 的最小
# 容量，實際值之後交給 Application Auto Scaling 管理。
# Celery concurrency 設為 1：放棄多工的成本效率，換取容量訊號的物理
# 意義 —— 不可見訊息數精確等於 In-flight Job 數。
# =====================================================================

resource "aws_ecs_cluster" "main" {
  name = "durable-queue"
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/durable-queue-worker"
  retention_in_days = 14
}


# =====================================================================
# Task 規格：CPU / 記憶體 / 暫存磁碟，回溯自 02 的量測
# ---------------------------------------------------------------------
# 執行過程不是純 I/O 等待：re-encode 階段是單執行緒 ffmpeg CPU 工作，且
# concurrency=1 代表沒有平行工作可以互相掩蓋這段時間。02 量測到 split_s
# 佔 video_duration 的比例穩定在 ~0.15–0.18%；Admission Limit
# （14400s）投影下 split ≈ 22s，量不大但是真的在燒 CPU，因此給 1 vCPU
# 而非最小的 0.25/0.5 vCPU 檔位，避免這段時間被鄰居任務排擠。1 vCPU 在
# Fargate 上最低相容記憶體是 2GB，這裡沒有額外理由加碼。
#
# 暫存磁碟：下載的原始音訊 + 重新編碼後的 64kbps mono 分段都寫在本機。
# 以 Admission Limit 的 4 小時影片估算，重新編碼後的分段總大小
# ≈ 14400s ÷ 1200s/chunk × 9.6MB/chunk ≈ 115MB；原始下載音訊量級相近或
# 更小。Fargate 預設 20GiB 已遠超這個量，這裡明確宣告 21GiB（顯式覆寫
# 的最小值）只是為了讓這個判斷寫進程式碼，而不是依賴一個沒人讀過的預設。
locals {
  worker_cpu                   = "1024" # 1 vCPU
  worker_memory                = "2048" # 2 GiB —— 1 vCPU 在 Fargate 的最低相容檔位
  worker_ephemeral_storage_gib = 21     # 平台預設 20GiB 已遠超 ~115MB 的估算用量；顯式宣告見上
}


# ── Execution role：ECS agent 用它 pull image、寫 CloudWatch Logs、
#    在容器啟動時解析 `secrets` 欄位指向的 Secrets Manager 值 ──────────
resource "aws_iam_role" "worker_execution" {
  name = "durable-queue-worker-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "worker_execution" {
  role       = aws_iam_role.worker_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "worker_execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.worker_execution.id

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


# ── Task role：應用程式執行期的權限。不再依賴虛擬機的 instance profile
#    ——只准對 celery 這一個佇列做 Worker 實際會做的動作。SendMessage 是
#    因為 tasks.py 的 autoretry_for 在 Worker 進程內部發出新訊息（見
#    queue.tf 的註解）。不含 DLQ（應用程式從不直接碰它）、不含
#    CreateQueue（佇列由 Terraform 建立，Worker 沒有能力另外造一個名稱
#    分歧的佇列）──────────────────────────────────────────────────────
resource "aws_iam_role" "worker_task" {
  name = "durable-queue-worker-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "worker_task_sqs" {
  name = "consume-celery-queue"
  role = aws_iam_role.worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:SendMessage"
        ]
        Resource = aws_sqs_queue.celery.arn
      },
      {
        # kombu 的 SQS transport 建連線時一定會呼叫 ListQueues 把佇列名稱
        # 解析成 URL（因為 queue.tf 刻意不用 predefined_queue_urls，見那邊
        # 註解）。這是帳號層級的列出型 API，不支援綁在單一佇列 ARN 上，只能
        # 跟 logs:DescribeLogGroups 一樣獨立用 Resource = "*"（實測過：沒
        # 這條，worker 連 broker 都連不上，Unrecoverable error 直接掛掉）。
        Effect   = "Allow"
        Action   = "sqs:ListQueues"
        Resource = "*"
      }
    ]
  })
}


# =====================================================================
# Task definition
# ---------------------------------------------------------------------
# 這是環境變數對帳檢查的部署來源（見 scripts/check_env_parity.py 的
# WORKER_TASK_DEFINITION_SOURCE）：`environment` / `secrets` 底下每一個
# 全大寫加底線的 name 都會被那支腳本解析出來，跟程式碼實際讀取的環境
# 變數對帳。清單必須與 durable_queue/.env.example 裡標記為必要的項目
# 完全一致，因為 API 和 Worker 共用同一份 Django settings.py，兩邊在
# import 時都要讀到全部必要變數。
# =====================================================================
resource "aws_ecs_task_definition" "worker" {
  family                   = "durable-queue-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.worker_cpu
  memory                   = local.worker_memory
  execution_role_arn       = aws_iam_role.worker_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  ephemeral_storage {
    size_in_gib = local.worker_ephemeral_storage_gib
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${data.aws_ecr_repository.registry.repository_url}:${var.image_tag}"
      essential = true
      command   = ["celery", "-A", "durable_queue", "worker", "-l", "info", "--concurrency=1"]

      environment = [
        { name = "POSTGRES_DB", value = aws_db_instance.postgres.db_name },
        { name = "POSTGRES_USER", value = aws_db_instance.postgres.username },
        { name = "POSTGRES_HOST", value = aws_db_instance.postgres.address },
        { name = "POSTGRES_PORT", value = tostring(aws_db_instance.postgres.port) },
        { name = "CELERY_BROKER_URL", value = local.celery_broker_url },
        { name = "CELERY_VISIBILITY_TIMEOUT", value = tostring(local.celery_visibility_timeout) },
        { name = "TRANSCRIBER", value = local.transcriber },
        { name = "TRANSCRIBE_SECONDS", value = tostring(local.transcribe_seconds) },
        { name = "GOOGLE_REDIRECT_URI", value = local.google_redirect_uri },
        { name = "FRONTEND_URL", value = local.frontend_url },
        { name = "CORS_ALLOWED_ORIGINS", value = local.frontend_url },
        { name = "DEBUG", value = "False" }
      ]

      secrets = [
        { name = "POSTGRES_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
        { name = "SECRET_KEY", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:secret_key::" },
        { name = "GOOGLE_CLIENT_ID", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:google_client_id::" },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = "${data.aws_secretsmanager_secret.app.arn}:google_client_secret::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = "ap-northeast-1"
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "durable-queue-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  launch_type     = "FARGATE"

  # 初始值等於 worker_autoscaling.tf 的最小容量；之後由 step scaling
  # policy 改變，Terraform 不應該把它改回來（見下面的 lifecycle block）。
  desired_count = 1

  network_configuration {
    subnets          = [for subnet in aws_subnet.private : subnet.id]
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  # desired_count 之後由 Application Auto Scaling（worker_autoscaling.tf）
  # 依 Backlog / In-flight Job 改變。忽略它的漂移，否則下一次
  # `terraform apply` 會把 scaling policy 剛設定好的容量改回這裡宣告的
  # 初始值，兩者互相打架。
  lifecycle {
    ignore_changes = [desired_count]
  }
}
