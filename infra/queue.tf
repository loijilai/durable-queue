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

  # 投遞次數上限不是重試計數器：一次投遞可能根本沒執行 Job（invocation 被
  # throttle、只是在等容量），所以重試上限由 handler 依 Job 實際被執行的次數
  # （worker_attempts，MAX_ATTEMPTS = 4）判斷，最後一次暫時性失敗記成 failed。
  # 10 留給等待造成的重送，DLQ 只收 handler 每次都沒能記錄結果（OOM、逾時、
  # 進程被殺）的訊息。
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 10
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
