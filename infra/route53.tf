# ── 把 durable-queue.loijilai.site 指到 ALB（alias A record）──────────
resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id # 外層：記錄寫進 route53 hosted zone
  name    = "durable-queue.loijilai.site"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id # 內層：ALB「自己的」canonical zone id（≠ 你的 zone）
    evaluate_target_health = true
  }
}
