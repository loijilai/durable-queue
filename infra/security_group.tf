# =====================================================================
# Security Groups（authorization 層）
# ---------------------------------------------------------------------
# 授權拓撲：
#   0.0.0.0/0 → SG-alb → SG-api ┐
#                               ├→ SG-rds / SG-redis
#                 SG-worker ────┘
#   worker 沒有 ingress —— 它是 Redis 的 client，主動 pull，回程靠 SG
#   stateful 自動放行。
# =====================================================================


# ── SG 空殼 ──────────────────────────────────────
resource "aws_security_group" "alb" {
  name   = "durable-queue-alb"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-alb" }
}

resource "aws_security_group" "api" {
  name   = "durable-queue-api"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-api" }
}

resource "aws_security_group" "worker" {
  name   = "durable-queue-worker"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-worker" }
}

resource "aws_security_group" "rds" {
  name   = "durable-queue-rds"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-rds" }
}

resource "aws_security_group" "redis" {
  name   = "durable-queue-redis"
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-redis" }
}


# =====================================================================
# Egress（一律 allow-all）
# ---------------------------------------------------------------------
# ip_protocol = "-1" 代表所有協定/所有 port；此時不寫 from/to_port。
# =====================================================================
resource "aws_vpc_security_group_egress_rule" "alb_all" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "worker_all" {
  security_group_id = aws_security_group.worker.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "rds_all" {
  security_group_id = aws_security_group.rds.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "redis_all" {
  security_group_id = aws_security_group.redis.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}


# =====================================================================
# Ingress
# ---------------------------------------------------------------------
# 每條 ingress rule 需要：
#   - ip_protocol = "tcp"
#   - from_port / to_port
#   - 來源二選一：
#       cidr_ipv4                    = "x.x.x.x/y"     ← 對外用 CIDR
#       referenced_security_group_id = aws_security_group.XXX.id  ← 對內用 SG 引用
# =====================================================================

# ── SG-alb：對外收 HTTPS ─────────────────────────────────────────────
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0" # 來源可以是所有 IPv4 位址
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0" # 來源可以是所有 IPv4 位址
}

# ── SG-api：只收 ALB 轉進來的流量 ───────────────────────────────────
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id = aws_security_group.api.id
  ip_protocol       = "tcp"
  from_port         = 8000
  to_port           = 8000
  # 只有綁定 SG-alb 的資源 才能連到綁定 SG-api 的資源的 TCP 8000 port
  referenced_security_group_id = aws_security_group.alb.id
}

# ── SG-worker：無 ingress ────────────────────────────────────────────
# worker 是 client，主動 pull，不接受任何 inbound。
# 只有上面那條 egress allow-all。

# ── SG-rds：Postgres，准 api 和 worker 進來 ─────────────────────────
resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_worker" {
  security_group_id            = aws_security_group.rds.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.worker.id
}

# ── SG-redis：Redis broker，准 api 和 worker 進來 ───────────────────
resource "aws_vpc_security_group_ingress_rule" "redis_from_api" {
  security_group_id            = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_worker" {
  security_group_id            = aws_security_group.redis.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.worker.id
}
