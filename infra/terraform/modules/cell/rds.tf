# RDS PostgreSQL 18 + PostGIS (extension'lar 0001 migratsiyasida yaratiladi: postgis, btree_gist, citext).
# Multi-AZ, PITR (backup_retention), KMS bilan shifrlangan, faqat TLS ulanishlar.

# Master parol faqat apply vaqtida mavjud (ephemeral) — state'ga yozilmaydi;
# RDS'ga password_wo, Secrets Manager'ga DATABASE_URL ichida (secret_string_wo) bir xil qiymat ketadi.
ephemeral "random_password" "db" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "${var.name}-pg18-"
  family      = "postgres${split(".", var.db_engine_version)[0]}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Sekin so'rovlar logga tushadi, lekin bind parametrlari (telefon va h.k.) yozilmaydi — loglarda PII yo'q
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "log_parameter_max_length"
    value = "0"
  }

  parameter {
    name  = "log_parameter_max_length_on_error"
    value = "0"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier = "${var.name}-pg"

  engine                      = "postgres"
  engine_version              = var.db_engine_version
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  instance_class              = var.db_instance_class
  parameter_group_name        = aws_db_parameter_group.main.name
  ca_cert_identifier          = "rds-ca-rsa2048-g1"

  db_name             = "matchup"
  username            = "matchup"
  password_wo         = ephemeral.random_password.db.result
  password_wo_version = var.db_password_version
  port                = 5432

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  # PITR: avtomatik backup + transaction log'lar, retention oynasi ichida istalgan soniyaga tiklash
  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "21:00-22:00" # UTC = Toshkent 02:00-03:00
  maintenance_window        = "sun:22:30-sun:23:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-pg-final"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  apply_immediately = !local.is_prod

  depends_on = [terraform_data.region_guard]
}
