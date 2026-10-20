# Secrets Manager: barcha maxfiy qiymatlar shu yerda, ECS ularni task start'da env sifatida beradi.
#
# Terraform boshqaradigan qiymatlar (DB va Valkey URL) write-only — state faylga yozilmaydi.
# Qolganlari (kalitlar, Payme, Click, Eskiz, Sentry) qo'lda to'ldiriladi: Terraform faqat bo'sh
# JSON skeletini bir marta yozadi va keyin qiymatga tegmaydi (ignore_changes). Qarang: docs/DEPLOYMENT.md.

locals {
  secret_prefix = "${var.name}/"

  # nom => JSON skeleti (kalitlar ECS secret valueFrom'da `:<key>::` bilan ishlatiladi)
  manual_secrets = {
    "signing-keys" = { jwt_private_key = "", jwt_public_key = "", ticket_private_key = "", ticket_public_key = "" }
    "payme"        = { merchant_id = "", key = "" }
    "click"        = { service_id = "", merchant_id = "", secret_key = "" }
    "eskiz"        = { email = "", password = "" }
    "sentry"       = { api_dsn = "", admin_dsn = "" }
  }
}

resource "aws_secretsmanager_secret" "manual" {
  for_each = local.manual_secrets

  name                    = "${local.secret_prefix}${each.key}"
  description             = "${var.name}: ${each.key} (qo'lda to'ldiriladi)"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.is_prod ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "manual_skeleton" {
  for_each = local.manual_secrets

  secret_id     = aws_secretsmanager_secret.manual[each.key].id
  secret_string = jsonencode(each.value)

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# --- Terraform boshqaradigan connection string'lar (write-only) ------------------------------
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.secret_prefix}database-url"
  description             = "${var.name}: DATABASE_URL (RDS, TLS verify-full)"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.is_prod ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # NODE_EXTRA_CA_CERTS (API image) RDS CA'larini ishonchli qiladi -> sertifikat va hostname tekshiriladi
  secret_string_wo = format(
    "postgres://%s:%s@%s:%d/%s?sslmode=verify-full",
    aws_db_instance.main.username,
    ephemeral.random_password.db.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
  )
  secret_string_wo_version = var.db_password_version
}

resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "${local.secret_prefix}redis-url"
  description             = "${var.name}: REDIS_URL (Valkey, TLS + AUTH)"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.is_prod ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id = aws_secretsmanager_secret.redis_url.id
  secret_string_wo = format(
    "rediss://:%s@%s:%d",
    ephemeral.random_password.cache.result,
    aws_elasticache_replication_group.main.primary_endpoint_address,
    aws_elasticache_replication_group.main.port,
  )
  secret_string_wo_version = var.cache_auth_token_version
}
