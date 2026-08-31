# Worker 的 step scaling policy：Backlog → Worker 數量。每個數字的推導見
# issues/scaling-control-loop/07-scaling-policy-derivations.md。

locals {
  # 下游限制中最低的一項：RDS db.t4g.micro 的連線預算。
  worker_scaling_ceiling = 67

  # Backlog > 1 代表有不只一個 Job 在等常駐 Worker 之外的容量。
  worker_scale_out_backlog_threshold = 1
}


resource "aws_appautoscaling_target" "worker" {
  min_capacity       = 1
  max_capacity       = local.worker_scaling_ceiling
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}


# alarm 只要留在 ALARM，每個 cooldown 就會再套用一次 step adjustment，
# 逐步逼近 ceiling 而不是一次跳到底。
resource "aws_cloudwatch_metric_alarm" "worker_backlog_high" {
  alarm_name          = "durable-queue-worker-backlog-high"
  alarm_description   = "Backlog 超過 min-capacity 常駐 Worker 能立即吸收的量，代表 burst 正在發生"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.celery.name }
  statistic           = "Maximum"
  period              = 60 # SQS 這個 metric 的原生發布頻率
  evaluation_periods  = 1
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


# 兩個非負的 SQS metric 相加後 <= 0，等同兩者皆為 0。精確為 0 才保證縮容
# 不會砍到執行中的 Job（ADR-0006）——ECS 縮容選中哪個 task 是不可控的。
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
    # 只在完全閒置時觸發，直接縮回 min capacity 是安全的。
    adjustment_type         = "ExactCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = 1
    }
  }
}
