# ElastiCache Valkey: BullMQ navbatlari, OTP limitlari, outbox stream. TLS + AUTH, KMS bilan shifrlangan.

ephemeral "random_password" "cache" {
  length  = 48
  special = false
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name}-cache"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_parameter_group" "main" {
  name   = "${var.name}-valkey${split(".", var.cache_engine_version)[0]}"
  family = "valkey${split(".", var.cache_engine_version)[0]}"

  # BullMQ: navbat kalitlari hech qachon evict qilinmasligi kerak
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name}-valkey"
  description          = "${var.name}: BullMQ, rate limit, outbox stream"

  engine               = "valkey"
  engine_version       = var.cache_engine_version
  node_type            = var.cache_node_type
  num_cache_clusters   = var.cache_node_count
  parameter_group_name = aws_elasticache_parameter_group.main.name
  port                 = 6379

  automatic_failover_enabled = var.cache_node_count > 1
  multi_az_enabled           = var.cache_node_count > 1

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.cache.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.main.arn
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token_wo              = ephemeral.random_password.cache.result
  auth_token_wo_version      = var.cache_auth_token_version
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit = local.is_prod ? 7 : 1
  snapshot_window          = "20:00-21:00"
  maintenance_window       = "sun:23:30-mon:00:30"
  apply_immediately        = !local.is_prod

  depends_on = [terraform_data.region_guard]
}
