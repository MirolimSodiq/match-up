# Eng kam huquq: har task turi uchun alohida execution role (faqat o'z ECR repo'si, log group'i va
# secret'lari) va task role (ilova runtime'da nima qila oladi).

locals {
  # execution role => ECR repo, log group, ruxsat etilgan secret ARN'lari
  exec_roles = {
    api = {
      repo      = "api"
      log_group = "api"
      secrets = concat(
        [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.redis_url.arn],
        [aws_secretsmanager_secret.media_worker_token.arn],
        [for k in ["signing-keys", "payme", "click", "eskiz", "sentry", "media-cdn", "telegram"] : aws_secretsmanager_secret.manual[k].arn],
      )
    }
    migrate = {
      repo      = "api"
      log_group = "migrate"
      secrets   = [aws_secretsmanager_secret.database_url.arn]
    }
    admin = {
      repo      = "admin"
      log_group = "admin"
      secrets   = [aws_secretsmanager_secret.manual["sentry"].arn]
    }
    media-worker = {
      repo      = "media-worker"
      log_group = "media-worker"
      secrets   = [aws_secretsmanager_secret.redis_url.arn, aws_secretsmanager_secret.media_worker_token.arn]
    }
  }
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:*"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# --- Execution role'lar (ECS agent: image pull, log, secret'larni env'ga berish) -------------
resource "aws_iam_role" "exec" {
  for_each = local.exec_roles

  name               = "${var.name}-${each.key}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "exec" {
  for_each = local.exec_roles

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    resources = [aws_ecr_repository.app[each.value.repo].arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.app[each.value.log_group].arn}:*"]
  }

  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = each.value.secrets
  }

  statement {
    sid       = "KmsForSecretsAndEcr"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com", "ecr.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "exec" {
  for_each = local.exec_roles

  name   = "exec"
  role   = aws_iam_role.exec[each.key].id
  policy = data.aws_iam_policy_document.exec[each.key].json
}

# --- Task role'lar (ilova kodi) ------------------------------------------------------------
resource "aws_iam_role" "task" {
  for_each = toset(["api", "admin"])

  name               = "${var.name}-${each.key}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# API: media bucket'larga faqat obyekt darajasida (presigned upload/download, o'chirish).
# Xom kliplar: multipart sessiya (Create/Complete = PutObject), qismlar ro'yxati, abort, HEAD.
data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "MediaObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }

  statement {
    sid       = "RawUploads"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = ["${aws_s3_bucket.media_raw.arn}/highlights/*", "${aws_s3_bucket.media_raw.arn}/recordings/*"]
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "media"
  role   = aws_iam_role.task["api"].id
  policy = data.aws_iam_policy_document.api_task.json
}

# ECS Exec (faqat yoqilgan bo'lsa)
data "aws_iam_policy_document" "ecs_exec" {
  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_exec" {
  for_each = var.enable_execute_command ? aws_iam_role.task : {}

  name   = "ecs-exec"
  role   = each.value.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}
