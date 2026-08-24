# =====================================================================
# SQS：真實佇列與它的 dead-letter queue
# ---------------------------------------------------------------------
# 佇列名稱固定為 "celery"：這是 Celery 的預設 task_default_queue，應用
# 程式從未自訂過，broker URL 也不帶佇列名稱 —— kombu 直接用這個名字呼叫
# GetQueueUrl 解析佇列，所以名稱不能改，也不需要 predefined_queue_urls。
# =====================================================================

resource "aws_sqs_queue" "celery" {
  name                       = "celery"
  visibility_timeout_seconds = local.celery_visibility_timeout

  # maxReceiveCount 是基礎設施層的投遞次數上限，與應用層 tasks.py 的
  # max_retries=3 是兩個獨立的計數器（ADR-0008）：應用層的 autoretry_for
  # 重試會發出一則新訊息、ack 掉舊的，不會增加這個計數；只有 Worker 根本
  # 沒機會執行到 except block 就死掉（OOM、被強制終止、卡死）時，同一則
  # 訊息才會在這裡累加接收次數。5 給了「Worker 剛好在被替換」這種良性
  # 重複一點餘裕，同時仍遠低於「毒訊息無限迴圈」。
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.celery_dlq.arn
    maxReceiveCount     = 5
  })

  tags = { Name = "durable-queue-celery" }
}

# DLQ：接住兩層重試都救不回來的訊息，不再消耗 Worker 容量。保留到 AWS
# 上限的 14 天，讓一則死訊息有充分時間被人工檢視，而不是在下一次
# apply/destroy 循環前就默默消失。
resource "aws_sqs_queue" "celery_dlq" {
  name                      = "celery-dlq"
  message_retention_seconds = 1209600

  tags = { Name = "durable-queue-celery-dlq" }
}
