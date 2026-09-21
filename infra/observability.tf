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
# 單一 dashboard、兩個上下對齊的 widget
# ---------------------------------------------------------------------
# 上面是佇列這一側：Backlog 與已被 ESM 領走的訊息數。下面是執行這一側：
# Worker Count 與 Queue Wait（右軸）。兩個 widget 同寬、同 period、同一個
# dashboard 時間範圍，上下對照即可做「容量變化有沒有真的影響等待時間」的因果
# 推論。「Backlog 大於零而 Worker Count 為零」是系統停擺的辨識特徵。
#
# 被領走的訊息不等於執行中的 Job：invocation 被 throttle 時，訊息照樣算在
# NotVisible 裡直到 visibility timeout 到期，所以它不叫 In-flight Jobs。
# =====================================================================
locals {
  dashboard_region = "ap-northeast-1"
  dashboard_period = 60
}

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
          title  = "Backlog / Received by poller"
          view   = "timeSeries"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.jobs.name,
              { label = "Backlog", stat = "Maximum" }
            ],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", aws_sqs_queue.jobs.name,
              { label = "Received by poller", stat = "Maximum" }
            ],
          ]
          yAxis = {
            left = { label = "messages", min = 0 }
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 24
        height = 8
        properties = {
          title  = "Worker Count / Queue Wait"
          view   = "timeSeries"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
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
            left  = { label = "workers", min = 0 }
            right = { label = "seconds", min = 0 }
          }
        }
      },
    ]
  })
}
