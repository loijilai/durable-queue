# =====================================================================
# 給部署流程用：跑一次性資料庫遷移 task（`aws ecs run-task`）需要知道
# 要接哪個 subnet / security group——這兩個值只在 Terraform 裡宣告過，
# 不該在 CI 腳本裡另外硬編一份。
# =====================================================================

output "private_subnet_ids" {
  value = [for subnet in aws_subnet.private : subnet.id]
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}
