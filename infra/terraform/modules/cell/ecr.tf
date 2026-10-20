# Image'lar: tegi o'zgarmas (git SHA), push'da skan, eski image'lar avtomatik tozalanadi.

locals {
  ecr_repos = toset(["api", "admin"])
}

resource "aws_ecr_repository" "app" {
  for_each = local.ecr_repos

  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Tegsiz image'lar 7 kundan keyin"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Oxirgi 50 ta image saqlanadi (rollback uchun yetarli)"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
        action       = { type = "expire" }
      },
    ]
  })
}
