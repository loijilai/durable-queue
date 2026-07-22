# ── RDS：DB subnet group ─────────────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name = "durable-queue-db"

  subnet_ids = [for subnet in aws_subnet.private : subnet.id]

  tags = { Name = "durable-queue-db" }
}


# ── RDS：Postgres instance ───────────────────────────────────────────
resource "aws_db_instance" "postgres" {
  identifier = "durable-queue-postgres"

  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t4g.micro"
  allocated_storage = 20
  storage_type      = "gp3"
  db_name           = "durable_queue"
  username          = "durable_queue"

  # 密碼交給 Secret Manager 託管
  manage_master_user_password = true

  # ── 網路 / 授權 ──
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # 只走 VPC 內網，不給 public IP

  multi_az = false

  # ── build-and-destroy 學習環境 ──
  skip_final_snapshot = true
  deletion_protection = false

  tags = { Name = "durable-queue-postgres" }
}


# ── ElastiCache：subnet group ────────────────────────────────────────
resource "aws_elasticache_subnet_group" "main" {
  name = "durable-queue-cache"

  subnet_ids = [for subnet in aws_subnet.private : subnet.id]

  tags = { Name = "durable-queue-cache" }
}


# ── ElastiCache：Redis ───────────────────────────────────────────────
# v1 單節點（num_cache_nodes = 1）。HA（replica 跨 AZ）先不做。
resource "aws_elasticache_cluster" "redis" {
  cluster_id = "durable-queue-redis"

  engine          = "redis"
  engine_version  = "7.0"
  node_type       = "cache.t4g.micro"
  num_cache_nodes = 1
  port            = 6379

  # ── 網路 / 授權 ──
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  tags = { Name = "durable-queue-redis" }
}
