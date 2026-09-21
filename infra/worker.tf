# =====================================================================
# Worker：AWS Lambda，由 Job 佇列的 event source mapping 觸發
# ---------------------------------------------------------------------
# 取代原本的 ECS/Fargate worker service 加一整套自己維護的 step scaling
# control loop。一份 Job = 一則訊息 = 一次 invocation（ESM batch_size = 1），
# 容量由平台依 Backlog 自動擴張，上限就是下面 ESM 的 maximum_concurrency。
# API 仍在 ECS/Fargate 上（見 api.tf）。
# =====================================================================

locals {
  # 900 秒是 Lambda 單次執行的上限，也是佇列的 visibility timeout
  # （queue.tf）。02 投影的 Admission Limit 下最長 Execution Time 是 352.1s，
  # 落在這個上限內。
  worker_timeout_seconds = 900

  # 記憶體：沿用 Fargate 上量到夠用的 2GiB。Lambda 的 vCPU 配額隨記憶體
  # 線性給，2048MB 約等於 1 vCPU，與原本 worker task 的 1 vCPU 同級——
  # re-encode 階段是單執行緒 ffmpeg CPU 工作，需要一整顆。
  worker_memory_mb = 2048

  # /tmp 的大小。下載的原始音訊加上重新編碼後的 64kbps mono 分段都寫在這裡；
  # Admission Limit 的 4 小時影片估算 ≈ 115MB，1024MB 留了充分餘裕。
  worker_ephemeral_storage_mb = 1024

  # Scaling Ceiling：下游限制中最低的一項，也就是 RDS db.t4g.micro 的連線預算。
  # 推導（原本記在 issues/scaling-control-loop 的 07，那份文件已經刪除，數字搬
  # 到這裡）：
  #
  #   max_connections 在 RDS 的預設參數是
  #   LEAST({DBInstanceClassMemory/9531392}, 5000)。1GiB 級距的機型扣掉 OS 與
  #   RDS 管理程序的保留後，實測預設值落在 80–90，取保守值 80 當預算基礎
  #   （部署後可用 SHOW max_connections; 核對）。
  #
  #   扣掉的消耗方：API service 2 個 task × 1 個 gunicorn worker = 2；一次性
  #   migrate task 執行期間 1；操作餘裕（人工 psql、apply 期間的瞬時重疊）10。
  #   80 − (2 + 1 + 10) = 67 個連線留給 Worker。
  #
  #   Worker 沒有連線池（Django 預設 CONN_MAX_AGE=0），一個 Worker 同時最多佔
  #   用 1 個連線，所以這個限制允許到 67 個 Worker。
  #
  # 要讓 ceiling 再往上，下一步是資料庫（更大的 instance class 或連線代理），
  # 不是 compute。
  worker_scaling_ceiling = 67

  # handler 冷啟動時解析成環境變數的機密（見
  # durable_queue/lambda_handler.py）。形式與 ECS task definition 的
  # `secrets` 欄位相同：<secret arn>:<json key>。Lambda 沒有同等的注入機制，
  # 而把值放進函式的環境變數會讓它們以明文出現在函式設定上，所以這裡只給
  # ARN。這份對照表同時是環境變數對帳的來源之一（見下方 environment）。
  worker_secret_env_sources = {
    POSTGRES_PASSWORD    = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password"
    SECRET_KEY           = "${data.aws_secretsmanager_secret.app.arn}:secret_key"
    GOOGLE_CLIENT_ID     = "${data.aws_secretsmanager_secret.app.arn}:google_client_id"
    GOOGLE_CLIENT_SECRET = "${data.aws_secretsmanager_secret.app.arn}:google_client_secret"
  }
}


resource "aws_cloudwatch_log_group" "worker" {
  # 名稱不是自由選的：Lambda 固定寫到 /aws/lambda/<function name>。先宣告它
  # 才能設保留天數，否則函式第一次被叫起來時會自己建一個永久保留的。
  name              = "/aws/lambda/durable-queue-worker"
  retention_in_days = 14
}


# ── Execution role：Lambda 服務代表函式取得的權限。VPC 網路介面是放進
#    private subnet 的代價；Logs 是函式寫自己的日誌；SQS 那四個動作是 ESM
#    代表函式操作佇列（ReceiveMessage/DeleteMessage/GetQueueAttributes）加上
#    handler 自己縮短 visibility 做退避（ChangeMessageVisibility）；
#    GetSecretValue 是冷啟動解析機密。沒有 SendMessage——Worker 從不送訊息；
#    沒有 DLQ——應用程式從不直接碰它 ─────────────────────────────────────
resource "aws_iam_role" "worker" {
  name = "durable-queue-worker"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# 用 AWS 受管政策而不是手寫：它給的就是「建/查/刪自己的 ENI」加上 Logs 寫入，
# 而 ENI 的 Describe 類 API 不支援 resource-level 限制，手寫只會得到同樣的
# Resource = "*" 再加上抄錯的風險。api.tf 的 execution role 用
# AmazonECSTaskExecutionRolePolicy 是同一個判斷。
resource "aws_iam_role_policy_attachment" "worker_vpc_access" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "worker_queue" {
  name = "consume-job-queue"
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ]
      Resource = aws_sqs_queue.jobs.arn
    }]
  })
}

resource "aws_iam_role_policy" "worker_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.worker.id

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


# ── Image pull：Lambda 服務在建立與更新函式時要從 ECR 拉 image，repo 沒有允許
#    它的 policy 時，Lambda 會試著自己寫一份，但那要求呼叫端（CD role）有
#    SetRepositoryPolicy，而且寫出來的內容不在 Terraform 裡。所以明確宣告。
#    repo 本身是 data source（見 shared.tf），但這份 policy 只在函式存在時
#    才有意義，跟著這一層建立與刪除 ─────────────────────────────────────
resource "aws_ecr_repository_policy" "lambda_pull" {
  repository = data.aws_ecr_repository.registry.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LambdaImagePull"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ]
      Condition = {
        StringLike = {
          "aws:sourceArn" = "arn:aws:lambda:ap-northeast-1:461346075470:function:durable-queue-worker"
        }
      }
    }]
  })
}


# =====================================================================
# Function
# ---------------------------------------------------------------------
# 這是環境變數對帳檢查的部署來源（見 scripts/check_env_parity.py 的
# LAMBDA_ENVIRONMENT_SOURCE）：這個檔案裡每一個全大寫加底線的鍵——不分
# 它是 `environment` 底下的明文變數，還是 worker_secret_env_sources 裡由
# handler 解析的機密——都會被那支腳本解析出來，跟程式碼實際讀取的環境變數
# 對帳。清單必須與 durable_queue/.env.example 裡標記為必要的項目完全一致，
# 因為 API 和 Worker 共用同一份 Django settings.py。
# =====================================================================
resource "aws_lambda_function" "worker" {
  function_name = "durable-queue-worker"
  role          = aws_iam_role.worker.arn

  # API 與 Worker 共用同一個 image 與 tag（build once, run many）。entrypoint
  # 由 image_config 覆寫，指向 image 裡的 awslambdaric 與這個 handler；
  # Dockerfile 本身沒有預設 entrypoint，因為 API 的啟動指令也是從外面給的。
  package_type = "Image"
  image_uri    = "${data.aws_ecr_repository.registry.repository_url}:${var.image_tag}"

  image_config {
    entry_point       = ["python", "-m", "awslambdaric"]
    command           = ["durable_queue.lambda_handler.handler"]
    working_directory = "/app"
  }

  timeout     = local.worker_timeout_seconds
  memory_size = local.worker_memory_mb

  ephemeral_storage {
    size = local.worker_ephemeral_storage_mb
  }

  # 沿用 worker security group：無 ingress，egress 走既有 NAT，連得到 RDS
  # 與外網（見 security_group.tf）。
  vpc_config {
    subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.worker.id]
  }

  environment {
    variables = {
      POSTGRES_DB          = aws_db_instance.postgres.db_name
      POSTGRES_USER        = aws_db_instance.postgres.username
      POSTGRES_HOST        = aws_db_instance.postgres.address
      POSTGRES_PORT        = tostring(aws_db_instance.postgres.port)
      JOB_QUEUE_URL        = aws_sqs_queue.jobs.url
      TRANSCRIBER          = local.transcriber
      TRANSCRIBE_SECONDS   = tostring(local.transcribe_seconds)
      GOOGLE_REDIRECT_URI  = local.google_redirect_uri
      FRONTEND_URL         = local.frontend_url
      CORS_ALLOWED_ORIGINS = local.frontend_url
      DEBUG                = "False"

      # Lambda 的檔案系統唯讀，只有 /tmp 可寫。yt-dlp 預設把 cache 寫進
      # $XDG_CACHE_HOME（沒設時是 $HOME/.cache），在 Lambda 上會是唯讀路徑。
      XDG_CACHE_HOME = "/tmp"

      SECRET_ENV_SOURCES = jsonencode(local.worker_secret_env_sources)
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker, aws_ecr_repository_policy.lambda_pull]

  # 部署順序的保證：terraform apply 跑在一次性 migrate task 之前，而改
  # image_uri 會讓 Lambda 立刻換程式碼——那就成了「Worker 跑在 schema 之前」。
  # 所以這裡只在建立函式時用 image_tag，之後的程式碼更新交給部署流程在
  # migrate 之後明確呼叫 UpdateFunctionCode（見 .github/workflows/ci-cd.yml
  # 的 Deploy worker function 與 deploy.sh）。
  #
  # 代價要講清楚：Terraform 從此不再收斂 Worker 跑的是哪個 image，`terraform
  # apply` 也不能用來回退它。換 image 這件事只有部署流程做得到。
  lifecycle {
    ignore_changes = [image_uri]
  }
}


# =====================================================================
# Event source mapping：Job 佇列 → 這個函式
# ---------------------------------------------------------------------
# batch_size = 1：一次 invocation 只處理一則訊息，也就是一份 Job。「Worker
# 數量 = In-flight Job 數量 = 容量單位」這個等式因此成立，也不需要 partial
# batch failure 回報。
#
# maximum_concurrency 實作 Scaling Ceiling（推導見上方 locals）。它是這條事件
# 來源的上限，不是函式的 reserved concurrency——超出的訊息留在 Backlog
# 等，不會被拒絕，也不會消耗投遞次數。
# =====================================================================
resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.worker.arn
  batch_size       = 1

  scaling_config {
    maximum_concurrency = local.worker_scaling_ceiling
  }
}
