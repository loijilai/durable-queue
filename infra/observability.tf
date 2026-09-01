# =====================================================================
# Dashboard、alarm 與 Queue Wait 的 metric filter
# ---------------------------------------------------------------------
# ADR-0007：系統中的每一個 metric，若非受管服務內建，即由 log 行經
# metric filter 導出。應用程式不呼叫任何 metric 發布介面。這份檔案裡
# 只有一個例外看起來像是「另一個 metric」——Worker 數量——但它同樣不是
# 應用程式發出的：RunningTaskCount 來自替 ECS cluster 開啟的 Container
# Insights（worker.tf），一樣是受管服務內建。
#
# issues/scaling-control-loop/08-dashboard-alarm-and-queue-wait-metric.md
# =====================================================================

locals {
  # 「最舊未完成 Job 年齡」的 alarm 門檻。這張票刻意排在 07（scaling
  # policy 的門檻推導）之前、不依賴它，所以這裡不能借用 07 的任何數字，
  # 只能借用當下已經有的、唯一從量測推導出來的時間常數：
  # celery_visibility_timeout（shared.tf）= 720s，本身已經是「02 量測到
  # 的 Admission Limit 最長 Execution Time（352.1s）× 安全係數 2」。
  #
  # 這裡再乘一次 2：720s 這個時間窗已經是「一個 Job 正常執行完最長要多
  # 久」的保守估計，如果最舊未完成的 Job 年齡超過它的兩倍，代表的已經不
  # 是「這一個 Job 剛好比較慢」，而是排隊或重複投遞正在發生——這正是這個
  # alarm 要抓的狀況。等 07 量出真正的 SLI 門檻後，這個常數應該被那個
  # 數字取代，而不是繼續借用 visibility timeout。
  oldest_job_age_alarm_threshold_seconds = local.celery_visibility_timeout * 2
}


# =====================================================================
# Queue Wait：由 04 發出的 log 欄位經 metric filter 導出
# ---------------------------------------------------------------------
# 04 在 Worker 取得 Job 時輸出一行帶 queue_wait_seconds 欄位的 JSON log
# （jobs/observability.py）。這裡把它轉成一個 metric，應用程式本身完全
# 不知道 CloudWatch 的存在。
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
# 單一 dashboard：四條線同一時間軸，另加「最舊未完成 Job 年齡」觀測線
# ---------------------------------------------------------------------
# 票上要求同一時間軸的是 Backlog、In-flight Job、Worker 數量、Queue
# Wait 這四條——它們在下面同一個 widget 裡，左軸放三個計數、右軸放
# Queue Wait 的秒數，這樣才能做「容量變化有沒有真的影響等待時間」的因果
# 推論。最舊未完成 Job 年齡是「另加」的觀測線（票原文），刻度（可能遠
# 大於 Queue Wait，見下方 alarm 門檻推導）與前四條不在同一量級，因此放
# 在第二個 widget；兩者仍在同一張 dashboard、共用同一段時間範圍，第二個
# widget 疊上 alarm 門檻的水平線以呼應第一個 widget 的 Queue Wait。
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
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.celery.name,
              { label = "Backlog", stat = "Maximum", yAxis = "left" }
            ],
            ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", aws_sqs_queue.celery.name,
              { label = "In-flight Jobs", stat = "Maximum", yAxis = "left" }
            ],
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.worker.name,
              { label = "Worker Count", stat = "Average", yAxis = "left" }
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
      {
        type   = "metric"
        x      = 0
        y      = 8
        width  = 24
        height = 6
        properties = {
          # 正名見 ADR-0002：這是「最舊未刪除訊息年齡」，Worker 延遲確認
          # 讓 in-flight 訊息也算在內，所以它是 Queue Wait 加上已執行
          # 時間，是 Completion Latency 的觀測代理，不是 Queue Wait。
          title  = "Oldest Unfinished Job Age (includes execution time — NOT Queue Wait; see ADR-0002)"
          view   = "timeSeries"
          region = "ap-northeast-1"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.celery.name,
              { label = "Oldest Unfinished Job Age (s)", stat = "Maximum" }
            ],
          ]
          annotations = {
            horizontal = [
              {
                label = "alarm threshold"
                value = local.oldest_job_age_alarm_threshold_seconds
              }
            ]
          }
        }
      },
    ]
  })
}


# =====================================================================
# 單一 alarm：最舊未完成 Job 年齡超過門檻
# =====================================================================
resource "aws_cloudwatch_metric_alarm" "oldest_job_age_high" {
  alarm_name          = "durable-queue-oldest-job-age-high"
  alarm_description   = "最舊未完成 Job 年齡超過門檻，代表系統正在跟不上（排隊或重複投遞），不是單一 Job 偶爾變慢"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.celery.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.oldest_job_age_alarm_threshold_seconds
  treat_missing_data  = "notBreaching"

  # 沒有 alarm_actions：這張票只要求「被通知」，通知管道（SNS/email/…）
  # 不在 spec 的 scope 內，也沒有量測告訴我們該接去哪裡。
}


# =====================================================================
# 執行階段耗時分解：臨機查詢，不預先聚合為 metric
# ---------------------------------------------------------------------
# 存成 CloudWatch Logs Insights 的 saved query definition，而不是寫在
# 某個文件裡：這樣「該查詢被記錄下來以便重複使用」直接發生在會被用到的
# 地方（Logs Insights 主控台的 saved queries 清單），而不是一段容易與
# 程式碼脫鉤的說明文字。
# =====================================================================
resource "aws_cloudwatch_query_definition" "execution_phase_breakdown" {
  # 名稱用 "/" 而非其他資源慣用的 "-"：Logs Insights 主控台把 "/" 當成
  # saved query 的資料夾分隔符號，這裡刻意借用這個慣例讓它出現在
  # "durable-queue" 這個資料夾底下，而不是跟其他服務的 saved query 混在
  # 同一層。
  name            = "durable-queue/execution-phase-breakdown"
  log_group_names = [aws_cloudwatch_log_group.worker.name]

  query_string = <<-QUERY
    fields @timestamp, job_id, stage, duration_seconds
    | filter message = "transcription stage completed"
    | stats avg(duration_seconds) as avg_seconds, max(duration_seconds) as max_seconds, count(*) as samples by stage
  QUERY
}
