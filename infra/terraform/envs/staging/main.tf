module "cell" {
  source = "../../modules/cell"

  name        = "matchup-staging"
  environment = "staging"

  vpc_cidr           = var.vpc_cidr
  single_nat_gateway = true

  route53_zone_id     = var.route53_zone_id
  api_domain          = var.api_domain
  admin_domain        = var.admin_domain
  admin_allowed_cidrs = var.admin_allowed_cidrs

  api_image_tag          = var.api_image_tag
  admin_image_tag        = var.admin_image_tag
  migrate_image_tag      = var.migrate_image_tag
  media_worker_image_tag = var.media_worker_image_tag

  # CI deploy: .github/workflows/deploy.yml, `environment: staging`
  github_oidc_provider_arn = var.github_oidc_provider_arn
  github_repository        = var.github_repository
  github_environment       = "staging"
  ops_telegram_chat_id     = var.ops_telegram_chat_id

  use_fargate_spot       = true
  enable_execute_command = true
  api_min_count          = 1
  api_max_count          = 2
  log_retention_days     = 30

  api_environment = {
    PAYME_CHECKOUT_URL = "https://checkout.test.paycom.uz"
  }

  db_instance_class        = "db.t4g.medium"
  db_allocated_storage     = 20
  db_max_allocated_storage = 100
  db_multi_az              = true
  db_backup_retention_days = 7
  deletion_protection      = false

  cache_node_type  = "cache.t4g.micro"
  cache_node_count = 1

  media_worker_min_count = 1
  media_worker_max_count = 2
}
