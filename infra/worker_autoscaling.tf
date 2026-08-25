# =====================================================================
# Worker 的 step scaling policy —— 把 Backlog 接上 Worker 數量
# ---------------------------------------------------------------------
# 三個決定完整保留在這裡（issues/scaling-control-loop/07-scaling-policy.md）：
#
# 1. Step scaling，不是 target tracking：target tracking 假設指標隨容量
#    上升而下降（像 CPU 使用率）；Backlog 由 submitter 送進來多少決定，
#    跟 Worker 有幾個沒有這種關係，硬套會震盪。
# 2. 最小容量是 1，不是 0：擴容門檻是為吸收 burst 而設的，Interactive
#    Submitter 的單一 Job 永遠達不到它；從 0 出發那份 Job 會無限等待。
# 3. 縮容同時檢查 Backlog 與 In-flight Job：Backlog 為空不代表系統閒置，
#    容器停止的寬限期遠短於一份 Job。ADR-0005 把併發設為 1，讓
#    ApproximateNumberOfMessagesNotVisible 精確等於 In-flight Job 數，
#    這裡才能只用一個 metric math 表達式，不需要 ECS 的
#    task scale-in protection。
#
# 每個數字的完整推導記錄在 issues/scaling-control-loop/
# 07-scaling-policy-derivations.md，不在這裡重複。
# =====================================================================

locals {
  # Scaling Ceiling：取「資料庫連線上限」與「轉錄 API rate limit」兩者
  # 推算結果中遠低於兩者的值（9），詳細算式見 derivations 文件。
  worker_scaling_ceiling = 9

  # 擴容門檻：Interactive Submitter 一次只送出 1 個 Job，min capacity=1
  # 的常駐 Worker 會在它出現的同一個 60s 取樣窗口內取走，Backlog 因此
  # 不會被單一 Job 推過 1。任何時候 Backlog > 1，代表有不只一個 Job 在
  # 排隊等待這個常駐 Worker 之外的容量——這就是 burst 的定義，不是挑出來
  # 的常數。
  worker_scale_out_backlog_threshold = 1
}


# ── 讓 ECS 這個 service 的 desired count 可以被 Application Auto Scaling
#    控制。不需要另外建 IAM role：ECS 用的是帳號層級既有的
#    service-linked role（AWSServiceRoleForApplicationAutoScaling_ECSService）──
resource "aws_appautoscaling_target" "worker" {
  min_capacity       = 1
  max_capacity       = local.worker_scaling_ceiling
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}


# =====================================================================
# 擴容：Backlog 超過門檻就加 Worker
# ---------------------------------------------------------------------
# Step scaling 而非 target tracking（見檔案開頭）。每次 alarm 進入
# ALARM 狀態都會套用一次 step adjustment；只要 Backlog 持續高於門檻，
# alarm 會在下一個 cooldown 之後重新評估並再加一次，逐步逼近 ceiling，
# 而不是一次跳到底——burst 的大小是未知的，逐步加比一次全開更容易觀察
# 迴路本身有沒有在動作。
# =====================================================================
resource "aws_cloudwatch_metric_alarm" "worker_backlog_high" {
  alarm_name          = "durable-queue-worker-backlog-high"
  alarm_description   = "Backlog 超過 min-capacity 常駐 Worker 能立即吸收的量，代表 burst 正在發生"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.celery.name }
  statistic           = "Maximum"
  period              = 60 # SQS 這個 metric 的原生發布頻率
  evaluation_periods  = 1  # burst 刻意做成短時間內幾百個 Job，反應要快，不等多個週期
  datapoints_to_alarm = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = local.worker_scale_out_backlog_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_appautoscaling_policy.worker_scale_out.arn]
}

resource "aws_appautoscaling_policy" "worker_scale_out" {
  name               = "durable-queue-worker-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 2
    }
  }
}


# =====================================================================
# 縮容：Backlog 與 In-flight Job 兩者皆為 0 才縮
# ---------------------------------------------------------------------
# 用 metric math 把兩個 SQS metric 相加成一個值（backlog + in-flight），
# 只在總和 <= 0 時才算閒置——這在數學上等同「兩者都是 0」，不是「兩者都
# 低於某個門檻」，因為兩個被加數都不可能是負的。門檻不取非零值，是因為
# 只有兩者都精確為 0 才能保證縮容不會砍到正在執行的 Job（ADR-0006）：
# 只要 in-flight 還有 1，那份 Job 可能落在任何一個 task 上，ECS 縮容時
# 選中哪個 task 是不可控的。
#
# 連續 3 個週期（3 分鐘）都閒置才觸發，避免最後一個 Job 才剛結束、下一個
# 又緊接著送達時的縮容再擴容抖動。
# =====================================================================
resource "aws_cloudwatch_metric_alarm" "worker_idle" {
  alarm_name          = "durable-queue-worker-idle"
  alarm_description   = "Backlog 與 In-flight Job 連續 3 分鐘皆為 0，縮回 min capacity"
  comparison_operator = "LessThanOrEqualToThreshold"
  threshold           = 0
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "outstanding"
    label       = "Backlog + In-flight Jobs"
    expression  = "backlog + in_flight"
    return_data = true
  }

  metric_query {
    id = "backlog"
    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesVisible"
      dimensions  = { QueueName = aws_sqs_queue.celery.name }
      period      = 60
      stat        = "Maximum"
    }
  }

  metric_query {
    id = "in_flight"
    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesNotVisible"
      dimensions  = { QueueName = aws_sqs_queue.celery.name }
      period      = 60
      stat        = "Maximum"
    }
  }

  alarm_actions = [aws_appautoscaling_policy.worker_scale_in.arn]
}

resource "aws_appautoscaling_policy" "worker_scale_in" {
  name               = "durable-queue-worker-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    # ExactCapacity 而非 ChangeInCapacity：這個 alarm 只在完全閒置
    # （兩個 metric 都精確為 0）時觸發，此時直接縮到 min capacity 是
    # 安全的——不管 ECS 挑中哪個 task 終止，都沒有 Job 在跑。
    adjustment_type         = "ExactCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = 1
    }
  }
}
