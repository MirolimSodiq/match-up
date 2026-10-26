# ECS Fargate: api va admin servislari + bir martalik migratsiya task'i (aws ecs run-task bilan).
# Deploy = yangi image tegi bilan apply; circuit breaker muvaffaqiyatsiz deploy'ni avtomatik qaytaradi.

resource "aws_cloudwatch_log_group" "app" {
  for_each = toset(["api", "admin", "migrate", "media-worker"])

  name              = "/ecs/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_ecs_cluster" "main" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = local.service_namespace
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "api" {
  name = "api"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      ttl  = 10
    }
  }
}

locals {
  capacity_provider = var.use_fargate_spot ? "FARGATE_SPOT" : "FARGATE"
  media_cdn_signed  = var.media_signing_public_key_pem != null

  # Teglar — deploy.tf (o'zgaruvchi yoki CI yozgan SSM parametri)
  api_image     = "${aws_ecr_repository.app["api"].repository_url}:${local.image_tag["api"]}"
  admin_image   = "${aws_ecr_repository.app["admin"].repository_url}:${local.image_tag["admin"]}"
  migrate_image = "${aws_ecr_repository.app["api"].repository_url}:${local.image_tag["migrate"]}"

  secret = {
    database_url = aws_secretsmanager_secret.database_url.arn
    redis_url    = aws_secretsmanager_secret.redis_url.arn
    signing_keys = aws_secretsmanager_secret.manual["signing-keys"].arn
    payme        = aws_secretsmanager_secret.manual["payme"].arn
    click        = aws_secretsmanager_secret.manual["click"].arn
    eskiz        = aws_secretsmanager_secret.manual["eskiz"].arn
    sentry       = aws_secretsmanager_secret.manual["sentry"].arn
    telegram     = aws_secretsmanager_secret.manual["telegram"].arn
  }

  api_env = merge(
    {
      NODE_ENV           = "production"
      PORT               = tostring(local.api_port)
      LOG_LEVEL          = "info"
      PUBLIC_BASE_URL    = "https://${var.api_domain}"
      RUN_WORKERS        = "true"
      OTP_PROVIDER       = "eskiz"
      SENTRY_ENVIRONMENT = var.environment
      MEDIA_BUCKET       = aws_s3_bucket.media.bucket
      MEDIA_RAW_BUCKET   = aws_s3_bucket.media_raw.bucket
      S3_REGION          = local.region
      # To'liq o'yin videosini ko'rish muddati — HLS lifecycle'i (storage.tf) bir kun kechroq o'chiradi
      MEDIA_RECORDING_EXPIRATION_DAYS = tostring(var.media_recording_expiration_days)
      # Ops ogohlantirishlaridagi havola (host no-show)
      ADMIN_PUBLIC_URL = "https://${var.admin_domain}"
      # Media navbati metrikasi (CloudWatch EMF) — worker autoscaling'i (media_worker.tf)
      CLOUDWATCH_METRICS_CELL = var.name
    },
    var.ops_telegram_chat_id == null ? {} : { OPS_TELEGRAM_CHAT_ID = var.ops_telegram_chat_id },
    # CloudFront signed URL faqat key group ulanganda; aks holda API S3 presigned GET beradi
    local.media_cdn_signed ? {
      MEDIA_CDN_DOMAIN      = aws_cloudfront_distribution.media.domain_name
      MEDIA_CDN_KEY_PAIR_ID = aws_cloudfront_public_key.media[0].id
    } : {},
    var.api_environment,
  )

  # Ed25519 PEM'lar env orqali keladi; image entrypoint'i ularni faylga yozadi (*_KEY_FILE)
  api_secrets = {
    DATABASE_URL       = local.secret.database_url
    REDIS_URL          = local.secret.redis_url
    JWT_PRIVATE_KEY    = "${local.secret.signing_keys}:jwt_private_key::"
    JWT_PUBLIC_KEY     = "${local.secret.signing_keys}:jwt_public_key::"
    TICKET_PRIVATE_KEY = "${local.secret.signing_keys}:ticket_private_key::"
    TICKET_PUBLIC_KEY  = "${local.secret.signing_keys}:ticket_public_key::"
    PAYME_MERCHANT_ID  = "${local.secret.payme}:merchant_id::"
    PAYME_KEY          = "${local.secret.payme}:key::"
    CLICK_SERVICE_ID   = "${local.secret.click}:service_id::"
    CLICK_MERCHANT_ID  = "${local.secret.click}:merchant_id::"
    CLICK_SECRET_KEY   = "${local.secret.click}:secret_key::"
    ESKIZ_EMAIL        = "${local.secret.eskiz}:email::"
    ESKIZ_PASSWORD     = "${local.secret.eskiz}:password::"
    SENTRY_DSN         = "${local.secret.sentry}:api_dsn::"
    # Telegram login va ops ogohlantirishlari; bo'sh — ikkalasi ham o'chiq
    TELEGRAM_BOT_TOKEN = "${local.secret.telegram}:bot_token::"
    MEDIA_WORKER_TOKEN = aws_secretsmanager_secret.media_worker_token.arn
  }
  # Entrypoint PEM'ni faylga yozadi -> MEDIA_CDN_PRIVATE_KEY_FILE
  api_media_secrets = local.media_cdn_signed ? { MEDIA_CDN_PRIVATE_KEY = "${aws_secretsmanager_secret.manual["media-cdn"].arn}:private_key::" } : {}

  log_options = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options = {
      awslogs-group         = g.name
      awslogs-region        = local.region
      awslogs-stream-prefix = k
    }
  } }

  runtime_platform = {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
}

# --- API -------------------------------------------------------------------------------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.exec["api"].arn
  task_role_arn            = aws_iam_role.task["api"].arn

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  # Root FS faqat o'qiladi; kalit fayllari va vaqtinchalik fayllar uchun ephemeral /tmp
  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name                   = "api"
    image                  = local.api_image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = local.api_port, protocol = "tcp" }]
    environment            = [for k, v in local.api_env : { name = k, value = v }]
    secrets                = [for k, v in merge(local.api_secrets, local.api_media_secrets) : { name = k, valueFrom = v }]
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp" }]
    linuxParameters        = { initProcessEnabled = true }
    stopTimeout            = 30
    logConfiguration       = local.log_options["api"]
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:${local.api_port}/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                   = "api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_min_count
  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = local.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = local.api_port
  }

  service_registries {
    registry_arn = aws_service_discovery_service.api.arn
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # desired_count'ni autoscaling boshqaradi
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.api]
}

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_count
  max_capacity       = var.api_max_count
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# --- Migratsiya (bir martalik task; servis emas) ---------------------------------------------
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.exec["migrate"].arn

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = local.migrate_image
    essential              = true
    readonlyRootFilesystem = true
    command                = ["node", "dist/scripts/migrate.js"]
    environment            = [{ name = "NODE_ENV", value = "production" }]
    secrets                = [{ name = "DATABASE_URL", valueFrom = local.secret.database_url }]
    logConfiguration       = local.log_options["migrate"]
  }])
}

# --- Admin -----------------------------------------------------------------------------------
resource "aws_ecs_task_definition" "admin" {
  family                   = "${var.name}-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.admin_cpu
  memory                   = var.admin_memory
  execution_role_arn       = aws_iam_role.exec["admin"].arn
  task_role_arn            = aws_iam_role.task["admin"].arn

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  volume {
    name = "next-cache"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name                   = "admin"
    image                  = local.admin_image
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = local.admin_port, protocol = "tcp" }]
    environment = [
      { name = "API_URL", value = local.api_internal_url },
      { name = "SENTRY_ENVIRONMENT", value = var.environment },
    ]
    secrets = [{ name = "SENTRY_DSN", valueFrom = "${local.secret.sentry}:admin_dsn::" }]
    mountPoints = [
      { sourceVolume = "next-cache", containerPath = "/app/apps/admin/.next/cache" },
      { sourceVolume = "tmp", containerPath = "/tmp" },
    ]
    linuxParameters  = { initProcessEnabled = true }
    logConfiguration = local.log_options["admin"]
  }])
}

resource "aws_ecs_service" "admin" {
  name                   = "admin"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.admin.arn
  desired_count          = var.admin_desired_count
  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"

  capacity_provider_strategy {
    capacity_provider = local.capacity_provider
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.admin.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.admin.arn
    container_name   = "admin"
    container_port   = local.admin_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.admin]
}
