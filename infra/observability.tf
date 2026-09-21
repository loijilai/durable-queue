# =====================================================================
# Dashboard 與 Queue Wait 的 metric filter
# ---------------------------------------------------------------------
# 每一個 metric 若非受管服務內建，即由 log 行經 metric filter 導出。應用
# 程式不呼叫任何 metric 發布介面。Worker 數量也不是應用程式發出的：
# ConcurrentExecutions 是 Lambda 自己發布的內建指標。
# =====================================================================


# =====================================================================
# Queue Wait：由 Worker 的結構化 log 行經 metric filter 導出
# ---------------------------------------------------------------------
# handler 在取得 Job 時輸出一行帶 queue_wait_seconds 欄位的 JSON log
# （jobs/worker.py）。這裡把它轉成一個 metric，應用程式本身完全不知道
# CloudWatch 的存在。
# =====================================================================
resource "aws_cloudwatch_log_metric_filter" "queue_wait" {
  name           = "durable-queue-queue-wait"
  log_group_name = aws_cloudwatch_log_group.worker.name

  # 同時比對 message 是為了避免任何其他日後新增的 log 行恰好也帶一個
  # 叫 queue_wait_seconds 的欄位，被誤算進這個 metric。
  pattern = "{ ($.message = \"job picked up by worker\") && ($.queue_wait_seconds = \"*\") }"

  metric_transformation {
    name      = "QueueWaitSeconds"
    namespace = "DurableQueue/Worker"
    value     = "$.queue_wait_seconds"
    unit      = "Seconds"
  }
}

locals {
  queue_wait_metric_namespace = aws_cloudwatch_log_metric_filter.queue_wait.metric_transformation[0].namespace
  queue_wait_metric_name      = aws_cloudwatch_log_metric_filter.queue_wait.metric_transformation[0].name
}


# =====================================================================
# 單一 dashboard、單一 widget：四條線同一時間軸
# ---------------------------------------------------------------------
# 左軸放三個計數、右軸放 Queue Wait 的秒數，才能做「容量變化有沒有真的影響
# 等待時間」的因果推論。「Backlog 大於零而 Worker Count 為零」是系統停擺的
# 辨識特徵，兩個計數都在這裡。
# =====================================================================
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "durable-queue"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 24
        height = 8
        properties = {
          title  = "Backlog / In-flight Jobs / Worker Count / Queue Wait"
          view   = "timeSeries"
          region = "ap-northeast-1"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.jobs.name,
              { label = "Backlog", stat = "Maximum", yAxis = "left" }
            ],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", aws_sqs_queue.jobs.name,
              { label = "In-flight Jobs", stat = "Maximum", yAxis = "left" }
            ],
            # 一次 invocation 就是一個 Worker（ESM batch_size = 1），所以同時
            # 執行數就是 Worker 數量，也是看得出有沒有打到 Scaling Ceiling 的線。
            ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", aws_lambda_function.worker.function_name,
              { label = "Worker Count", stat = "Maximum", yAxis = "left" }
            ],
            [local.queue_wait_metric_namespace, local.queue_wait_metric_name,
              { label = "Queue Wait (s)", stat = "Average", yAxis = "right" }
            ],
          ]
          yAxis = {
            left  = { label = "count", min = 0 }
            right = { label = "seconds", min = 0 }
          }
        }
      },
    ]
  })
}
