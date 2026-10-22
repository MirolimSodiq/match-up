# Highlight video pipeline (ARCHITECTURE §4.10):
#   telefon --presigned multipart--> S3 media-raw --(Redis Stream matchup:media-jobs)--> Python media worker (ECS)
#   worker --> S3 media (HLS, thumbnail, 9:16 MP4) --> CloudFront (signed URL)
# Worker DB'ga yozmaydi: natijani API'ning ichki endpointiga (service discovery, servis token) yuboradi.
# Ikki lane (bitta image): `default` — kliplar (daqiqalar, Spot), `recording` — AI-Cam A to'liq o'yin yozuvlari
# (soatlab kodlash, katta disk, on-demand). GPU/AI job'lari keyinchalik SQS + AWS Batch'da (docs/AI_CAM.md).

# --- Xom kliplar bucket'i: faqat presigned PUT/GET, CloudFront orqali ochilmaydi -------------------
resource "aws_s3_bucket" "media_raw" {
  bucket = "${var.name}-media-raw-${local.account_id}"

  depends_on = [terraform_data.region_guard]
}

resource "aws_s3_bucket_public_access_block" "media_raw" {
  bucket                  = aws_s3_bucket.media_raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media_raw" {
  bucket = aws_s3_bucket.media_raw.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media_raw" {
  bucket = aws_s3_bucket.media_raw.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media_raw" {
  bucket = aws_s3_bucket.media_raw.id

  rule {
    id     = "raw-expire"
    status = "Enabled"

    filter {}

    expiration {
      days = var.media_raw_expiration_days
    }

    # API sessiyasi (MEDIA_UPLOAD_SESSION_HOURS 48 soat, yozuvlar — MEDIA_RECORDING_SESSION_HOURS 60 soat) tugagach
    # housekeeping abort qiladi; bu — zaxira (yozuv sessiyasi shundan qisqa bo'lishi shart)
    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}

data "aws_iam_policy_document" "media_raw_bucket" {
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media_raw.arn, "${aws_s3_bucket.media_raw.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media_raw" {
  bucket = aws_s3_bucket.media_raw.id
  policy = data.aws_iam_policy_document.media_raw_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.media_raw]
}

# --- Worker <-> API servis token (Terraform generatsiya qiladi, state'ga yozilmaydi) ----------------
ephemeral "random_password" "media_worker_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "media_worker_token" {
  name                    = "${local.secret_prefix}media-worker-token"
  description             = "${var.name}: MEDIA_WORKER_TOKEN (API /internal/media/* va media worker)"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.is_prod ? 30 : 7
}

resource "aws_secretsmanager_secret_version" "media_worker_token" {
  secret_id                = aws_secretsmanager_secret.media_worker_token.id
  secret_string_wo         = ephemeral.random_password.media_worker_token.result
  secret_string_wo_version = var.media_worker_token_version
}

# --- Worker IAM: xom klipni o'qish, natijani yozish ------------------------------------------------
# highlights/ — host kliplari va belgilardan kesilgan kliplar; recordings/ — to'liq o'yin yozuvlari (klip manbai ham)
data "aws_iam_policy_document" "media_worker_task" {
  statement {
    sid       = "ReadRaw"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media_raw.arn}/highlights/*", "${aws_s3_bucket.media_raw.arn}/recordings/*"]
  }

  statement {
    sid       = "WriteOutputs"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.media.arn}/highlights/*", "${aws_s3_bucket.media.arn}/recordings/*"]
  }

  # ListBucket bo'lmasa yo'q manifest uchun S3 404 o'rniga 403 qaytaradi (idempotent qayta urinish shunga tayanadi)
  statement {
    sid       = "ListOutputs"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["highlights/*", "recordings/*"]
    }
  }
}

resource "aws_iam_role" "media_worker_task" {
  name               = "${var.name}-media-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "media_worker_task" {
  name   = "media"
  role   = aws_iam_role.media_worker_task.id
  policy = data.aws_iam_policy_document.media_worker_task.json
}

# --- Tarmoq: worker -> API (service discovery), Valkey, S3/ECR (NAT) --------------------------------
resource "aws_security_group" "media_worker" {
  name        = "${var.name}-media-worker"
  description = "Media worker (FFmpeg)"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "media_worker_all" {
  security_group_id = aws_security_group.media_worker.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "api_from_media_worker" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.media_worker.id
  ip_protocol                  = "tcp"
  from_port                    = local.api_port
  to_port                      = local.api_port
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_media_worker" {
  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = aws_security_group.media_worker.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

# --- ECS servislar (lane bo'yicha) ----------------------------------------------------------------
locals {
  media_worker_image = "${aws_ecr_repository.app["media-worker"].repository_url}:${local.image_tag["media-worker"]}"

  media_worker_lanes = {
    # Kliplar (≤ 60 s) — Spot, standart disk (20 GiB)
    default = {
      service     = "media-worker"
      stream      = "matchup:media-jobs"
      cpu         = var.media_worker_cpu
      memory      = var.media_worker_memory
      storage_gib = null
      spot        = true
      min_count   = var.media_worker_min_count
      max_count   = var.media_worker_max_count
    }
    # To'liq o'yin (90 daq 4K ~15 GB manba + HLS): katta disk; kodlash soatlab — Spot uzilishi butun ishni qaytaradi
    recording = {
      service     = "media-worker-recording"
      stream      = "matchup:media-jobs:recording"
      cpu         = var.media_recording_worker_cpu
      memory      = var.media_recording_worker_memory
      storage_gib = var.media_recording_worker_storage_gib
      spot        = false
      min_count   = var.media_recording_worker_min_count
      max_count   = var.media_recording_worker_max_count
    }
  }
}

moved {
  from = aws_ecs_task_definition.media_worker
  to   = aws_ecs_task_definition.media_worker["default"]
}

moved {
  from = aws_ecs_service.media_worker
  to   = aws_ecs_service.media_worker["default"]
}

moved {
  from = aws_appautoscaling_target.media_worker
  to   = aws_appautoscaling_target.media_worker["default"]
}

moved {
  from = aws_appautoscaling_policy.media_worker_cpu
  to   = aws_appautoscaling_policy.media_worker_cpu["default"]
}

resource "aws_ecs_task_definition" "media_worker" {
  for_each = local.media_worker_lanes

  family                   = "${var.name}-${each.value.service}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.exec["media-worker"].arn
  task_role_arn            = aws_iam_role.media_worker_task.arn

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  # Ish papkasi (manba + HLS) — Fargate ephemeral storage (standart 20 GiB; yozuv lane'ida kattaroq)
  dynamic "ephemeral_storage" {
    for_each = each.value.storage_gib == null ? [] : [each.value.storage_gib]

    content {
      size_in_gib = ephemeral_storage.value
    }
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([{
    name                   = "media-worker"
    image                  = local.media_worker_image
    essential              = true
    readonlyRootFilesystem = true
    environment = [for k, v in {
      API_INTERNAL_URL  = local.api_internal_url
      S3_REGION         = local.region
      MEDIA_JOBS_STREAM = each.value.stream
      WORK_DIR          = "/tmp/media-worker"
      LOG_LEVEL         = "INFO"
    } : { name = k, value = v }]
    secrets = [
      { name = "REDIS_URL", valueFrom = local.secret.redis_url },
      { name = "MEDIA_WORKER_TOKEN", valueFrom = aws_secretsmanager_secret.media_worker_token.arn },
    ]
    mountPoints     = [{ sourceVolume = "tmp", containerPath = "/tmp" }]
    linuxParameters = { initProcessEnabled = true }
    # SIGTERM -> joriy job tugaydi (60 s klip ~1 daq); tugamasa xabar boshqa worker'ga qaytadi. Yozuv kodlashi
    # 120 s da tugamaydi — deploy/scale-in paytida u boshqa task'da qaytadan boshlanadi (docs/DEPLOYMENT.md)
    stopTimeout = 120
    logConfiguration = merge(local.log_options["media-worker"], {
      options = merge(local.log_options["media-worker"].options, { awslogs-stream-prefix = each.value.service })
    })
    healthCheck = {
      command     = ["CMD", "python", "-m", "media_worker", "health"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "media_worker" {
  for_each = local.media_worker_lanes

  name                   = each.value.service
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.media_worker[each.key].arn
  desired_count          = each.value.min_count
  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"

  # Transcode qayta boshlanadigan (idempotent) — kliplar uchun spot uzilishi xavfsiz
  capacity_provider_strategy {
    capacity_provider = each.value.spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.media_worker.id]
    assign_public_ip = false
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_appautoscaling_target" "media_worker" {
  for_each = local.media_worker_lanes

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.media_worker[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.min_count
  max_capacity       = each.value.max_count
}

# FFmpeg CPU'ni to'liq ishlatadi — CPU bo'yicha kengayish. Navbat uzunligi (XLEN/XPENDING) metrikasi — follow-up.
resource "aws_appautoscaling_policy" "media_worker_cpu" {
  for_each = local.media_worker_lanes

  name               = "${var.name}-${each.value.service}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.media_worker[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.media_worker[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.media_worker[each.key].scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# --- Tashqi ALB worker endpointlarini ochmaydi --------------------------------------------------
resource "aws_lb_listener_rule" "api_internal_block" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 5

  condition {
    host_header {
      values = [var.api_domain]
    }
  }

  condition {
    path_pattern {
      values = ["/internal/*"]
    }
  }

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"status\":404,\"code\":\"NOT_FOUND\"}"
    }
  }
}
