# CI deploy (GitHub Actions, .github/workflows/deploy.yml + infra/deploy/ecs-deploy.sh).
#
# Deploy Terraform'siz: CI image'ni ECR'ga push qiladi, migratsiya task'ini yangi image bilan ishga tushiradi,
# servislarga yangi task definition revision'larini beradi va joriy tegni SSM'ga yozadi. Terraform image tegini
# o'sha SSM parametridan o'qiydi — operatorning keyingi `terraform apply` i deploy qilingan versiyani orqaga
# qaytarmaydi. Infratuzilma o'zgarishlari (VPC, RDS, IAM, env) avvalgidek operator `terraform apply` i bilan.
#
# CI role tor: faqat shu cell'ning ECR repo'lariga push, ECS servislarini yangilash, migratsiya task'i,
# shu cell role'larini ECS'ga berish (PassRole) va image-tag parametrlari. IAM/VPC/RDS'ga huquq yo'q.

locals {
  image_components = toset(["api", "admin", "migrate", "media-worker"])

  image_tag_overrides = {
    api            = var.api_image_tag
    admin          = var.admin_image_tag
    migrate        = var.migrate_image_tag
    "media-worker" = var.media_worker_image_tag
  }

  deploy_enabled     = var.github_oidc_provider_arn != null && var.github_repository != null
  github_environment = coalesce(var.github_environment, var.environment)
}

# Joriy (oxirgi deploy qilingan) teglar. Terraform faqat boshlang'ich qiymatni yozadi, keyin CI boshqaradi.
resource "aws_ssm_parameter" "image_tag" {
  for_each = local.image_components

  name           = "/${var.name}/image-tags/${each.key}"
  description    = "${var.name}: ${each.key} image tegi (CI deploy yozadi)"
  type           = "String"
  insecure_value = coalesce(local.image_tag_overrides[each.key], each.key == "migrate" ? var.api_image_tag : null, "initial")

  lifecycle {
    ignore_changes = [insecure_value]
  }
}

data "aws_ssm_parameter" "image_tag" {
  for_each = aws_ssm_parameter.image_tag

  name = each.value.name

  # Birinchi apply'da parametr hali yo'q — o'qish apply vaqtiga qoldiriladi
  depends_on = [aws_ssm_parameter.image_tag]
}

locals {
  # Aniq berilgan o'zgaruvchi > SSM (CI) > migrate uchun api tegi
  image_tag = { for k in local.image_components : k => coalesce(local.image_tag_overrides[k], data.aws_ssm_parameter.image_tag[k].insecure_value) }
}

# ecs-deploy.sh shu yerdan o'qiydi: nomlar Terraform'da bir joyda, skriptda qattiq yozilmaydi
resource "aws_ssm_parameter" "deploy_config" {
  name        = "/${var.name}/deploy/config"
  description = "${var.name}: CI deploy konfiguratsiyasi (infra/deploy/ecs-deploy.sh)"
  type        = "String"
  insecure_value = jsonencode({
    region     = local.region
    cluster    = aws_ecs_cluster.main.name
    tag_prefix = "/${var.name}/image-tags"
    ecr        = { for k, r in aws_ecr_repository.app : k => r.repository_url }
    platform   = var.cpu_architecture == "ARM64" ? "linux/arm64" : "linux/amd64"
    migrate = {
      task_definition = aws_ecs_task_definition.migrate.family
      container       = "migrate"
      repo            = "api"
      log_group       = aws_cloudwatch_log_group.app["migrate"].name
      subnets         = aws_subnet.private[*].id
      security_groups = [aws_security_group.api.id]
    }
    # Tartib muhim emas — hammasi birga yangilanadi va birga barqarorlik kutiladi
    services = concat(
      [
        { service = aws_ecs_service.api.name, container = "api", repo = "api" },
        { service = aws_ecs_service.admin.name, container = "admin", repo = "admin" },
      ],
      [for lane, s in aws_ecs_service.media_worker : { service = s.name, container = "media-worker", repo = "media-worker" }],
    )
  })
}

# --- GitHub Actions OIDC role ---------------------------------------------------------------
data "aws_iam_policy_document" "deploy_assume" {
  count = local.deploy_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Faqat shu repo'ning shu environment'i (workflow'da `environment: <...>`) — boshqa branch, PR yoki fork emas
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${local.github_environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  count = local.deploy_enabled ? 1 : 0

  name                 = "${var.name}-github-deploy"
  description          = "${var.github_repository} (${local.github_environment}) CI deploy: ECR push, ECS deploy, migratsiya"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume[0].json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  count = local.deploy_enabled ? 1 : 0

  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }

  statement {
    sid       = "KmsForEcr"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ecr.${local.region}.amazonaws.com"]
    }
  }

  # Task definition API'lari resource darajasini qo'llamaydi
  statement {
    sid       = "TaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid       = "Services"
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:service/${aws_ecs_cluster.main.name}/*"]
  }

  statement {
    sid       = "MigrateTask"
    actions   = ["ecs:RunTask"]
    resources = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:task-definition/${aws_ecs_task_definition.migrate.family}:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid       = "Tasks"
    actions   = ["ecs:DescribeTasks"]
    resources = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:task/${aws_ecs_cluster.main.name}/*"]
  }

  # Yangi revision'lar mavjud role'lar bilan ro'yxatdan o'tadi (o'zgarmaydi) — faqat shu cell'niki, faqat ECS'ga
  statement {
    sid     = "PassCellRoles"
    actions = ["iam:PassRole"]
    resources = concat(
      [for r in aws_iam_role.exec : r.arn],
      [for r in aws_iam_role.task : r.arn],
      [aws_iam_role.media_worker_task.arn],
    )

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "DeployConfig"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.deploy_config.arn]
  }

  statement {
    sid       = "ImageTags"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = [for p in aws_ssm_parameter.image_tag : p.arn]
  }

  # Migratsiya xato qilsa — log CI'da ko'rinsin
  statement {
    sid       = "MigrateLogs"
    actions   = ["logs:GetLogEvents"]
    resources = ["${aws_cloudwatch_log_group.app["migrate"].arn}:*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  count = local.deploy_enabled ? 1 : 0

  name   = "deploy"
  role   = aws_iam_role.deploy[0].id
  policy = data.aws_iam_policy_document.deploy[0].json
}
