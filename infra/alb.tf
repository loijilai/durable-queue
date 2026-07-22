# ── ALB 本體 ─────────────────────────────────────────────────────────
resource "aws_lb" "main" {
  name               = "durable-queue-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = [for subnet in aws_subnet.public : subnet.id]
  security_groups    = [aws_security_group.alb.id]

  tags = { Name = "durable-queue-alb" }
}


# ── Target Group（後端目標池 + health check）─────────────────────────
resource "aws_lb_target_group" "api" {
  name        = "durable-queue-api"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path    = "/health/"
    matcher = 200
  }

  tags = { Name = "durable-queue-api" }
}


# ── Listener（ALB 對外）────────────────────────────────────────
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn

  port       = 443
  protocol   = "HTTPS"
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09"
  # 等待 ISSUED 後才建立 listener
  certificate_arn = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn

  port     = 80
  protocol = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
