# ── 子網域的 public hosted zone ──────────────────────────────────────
resource "aws_route53_zone" "main" {
  name = "durable-queue.loijilai.site"

  tags = { Name = "durable-queue" }
}


# ── apply 後要拿去 Namecheap 貼的 4 台 nameserver ──────────────────────
output "name_servers" {
  value = aws_route53_zone.main.name_servers
}

# zone_id：infra/ 那份 state 的 data source 會靠名字查到它，
output "zone_id" {
  value = aws_route53_zone.main.zone_id
}
