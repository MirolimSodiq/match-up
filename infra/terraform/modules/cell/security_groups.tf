# Trafik yo'nalishi: internet -> ALB -> api/admin; admin -> api (ichki DNS); api -> RDS, Valkey.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Internet-facing ALB"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "API va migratsiya task'lari"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-api" }
}

resource "aws_security_group" "admin" {
  name        = "${var.name}-admin"
  description = "Admin panel (Next.js BFF)"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-admin" }
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-db" }
}

resource "aws_security_group" "cache" {
  name        = "${var.name}-cache"
  description = "ElastiCache Valkey"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-cache" }
}

# --- ALB ---------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP -> HTTPS redirect"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
}

resource "aws_vpc_security_group_egress_rule" "alb_to_admin" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.admin.id
  ip_protocol                  = "tcp"
  from_port                    = local.admin_port
  to_port                      = local.admin_port
}

# --- API ---------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
}

resource "aws_vpc_security_group_ingress_rule" "api_from_admin" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.admin.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
}

# Tashqi provayderlar (Payme, Click, Eskiz, Sentry) va AWS API'lari NAT orqali
resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Admin -------------------------------------------------------------------
resource "aws_vpc_security_group_ingress_rule" "admin_from_alb" {
  security_group_id            = aws_security_group.admin.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.admin_port
  to_port                      = local.admin_port
}

resource "aws_vpc_security_group_egress_rule" "admin_all" {
  security_group_id = aws_security_group.admin.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Ma'lumotlar qatlami: faqat API SG'dan --------------------------------------
resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_api" {
  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
