# ── 跨 state 讀 hosted zone
data "aws_route53_zone" "main" {
  name = "durable-queue.loijilai.site"
}


# ── 申請憑證 ────────────
resource "aws_acm_certificate" "main" {
  domain_name       = "durable-queue.loijilai.site"
  validation_method = "DNS"

  # 憑證換新時先建新的再換掉舊的，避免 listener 短暫沒憑證可用。
  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "durable-queue" }
}


# ── 把 ACM 要求的驗證 CNAME 寫進 zone（證明控制網域）──────────────
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in aws_acm_certificate.main.domain_validation_options : o.domain_name => o
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 60
}


# ── 同步點：卡住 apply，輪詢直到 ACM 把憑證標記為 ISSUED ─────────────
# 讓 443 listener 拿到已生效的憑證。
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}