# =====================================================================
# 跨 2 AZ 的網路地基
# ---------------------------------------------------------------------
# NAT 決策：只開 1 個，省一半錢。
#   代價 = egress 是 SPOF —— 那個 AZ 掛了，兩個 private subnet 都暫時不能
#   出網。
#
# 連帶結果：因為只有 1 個 NAT，兩個 private subnet 的預設路由都指向同一個
#   NAT → private route table 只需「一張共用」。若哪天改成每 AZ 一個 NAT，
#   這裡就得變成「每 AZ 一張 private route table」。
# =====================================================================


# ── 哪些 AZ、每個 subnet 切哪段 CIDR（決策）──────────────────────────
locals {
  public_subnets = {
    a = { az = "ap-northeast-1a", cidr = "10.0.1.0/24" }
    c = { az = "ap-northeast-1c", cidr = "10.0.2.0/24" }
  }

  private_subnets = {
    a = { az = "ap-northeast-1a", cidr = "10.0.11.0/24" }
    c = { az = "ap-northeast-1c", cidr = "10.0.12.0/24" }
  }
}


# ── VPC ──────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "durable-queue" }
}


# ── Subnets（for_each：每個 AZ 一份）─────────────────────────────────
# for_each 把上面 map 的「每一筆」各長成一個 subnet。
resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = false # 只放 ALB / NAT，沒有需要自動 public IP 的 EC2

  tags = { Name = "durable-queue-public-${each.key}" }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value.cidr
  availability_zone = each.value.az

  tags = { Name = "durable-queue-private-${each.key}" }
}


# ── Internet Gateway（VPC 層級，1 個就夠）────────────────────────────
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-igw" }
}


# ── NAT Gateway（只 1 個，放在其中一個 public subnet）────────────────
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "durable-queue-nat-eip" }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id

  # NAT 放進 key = "a" 的 public subnet？
  subnet_id = aws_subnet.public["a"].id

  depends_on = [aws_internet_gateway.igw]
  tags       = { Name = "durable-queue-nat" }
}


# ── Public route table（1 張共用：所有 public subnet 路由都一樣）─────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-public-rt" }
}

resource "aws_route" "public_default" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

# Association
resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public # 已建立的 Subnet 資源

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}


# ── Private route table（1 張共用，因為只有 1 個 NAT）────────────────
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "durable-queue-private-rt" }
}

resource "aws_route" "private_default" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}

# Association
resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}
