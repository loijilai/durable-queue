# ── ALB 本體 ─────────────────────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "durable-queue-alb"
  load_balancer_type = "application"
  internal = false
  subnets = [for subnet in aws_subnet.public : subnet.id]
  security_groups = [aws_security_group.alb.id]

  tags = { Name = "durable-queue-alb" }
}


# ── Target Group（後端目標池 + health check）─────────────────────────
resource "aws_lb_target_group" "api" {
  name = "durable-queue-api"
  port = 8000
  protocol = "HTTP"
  vpc_id = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path = "/health/"
    matcher = 200
  }

  tags = { Name = "durable-queue-api" }
}


# ── Listener（ALB 對外）────────────────────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn

  # TODO: HTTP first
  port = 80
  protocol = "HTTP"

  # 收到請求後預設動作：轉發到上面那個 target group。
  default_action {
    type = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
