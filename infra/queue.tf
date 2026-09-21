# =====================================================================
# SQS：Job 佇列與它的 dead-letter queue
# ---------------------------------------------------------------------
# API 把 {"job_id": <id>} 送進這個佇列，event source mapping（worker.tf）
# 把每一則訊息交給一次 Lambda invocation。名稱不再與任何函式庫綁定。
# =====================================================================

resource "aws_sqs_queue" "jobs" {
  name = "durable-queue-jobs"

  # 函式最長就跑這麼久（worker.tf），訊息在它結束之前都不該被重送。取用同一個
  # local 而不是各寫一個 900，兩者相等就不必靠註解維持。
  visibility_timeout_seconds = local.worker_timeout_seconds

  # 投遞次數上限，也是唯一的重試計數器——Celery 那層應用層重試已經不存在。
  # 4 = 第一次加三次重試，與 handler 的 MAX_ATTEMPTS 相同，讓最後一次暫時性
  # 失敗由 handler 記成 failed；只有 handler 根本沒機會記錄結果就死掉（OOM、
  # 逾時、進程被殺）的訊息才會用完四次投遞落到 DLQ。
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 4
  })

  tags = { Name = "durable-queue-jobs" }
}

# DLQ：接住連 handler 都沒能記錄結果的訊息，不再消耗 Worker 容量。保留到
# AWS 上限的 14 天，讓一則死訊息有充分時間被人工檢視，而不是在下一次
# apply/destroy 循環前就默默消失。
resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "durable-queue-jobs-dlq"
  message_retention_seconds = 1209600

  tags = { Name = "durable-queue-jobs-dlq" }
}
