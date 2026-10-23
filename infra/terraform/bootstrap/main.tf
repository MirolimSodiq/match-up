# Hisob darajasidagi resurslar (bir marta, lokal state bilan):
#   * Terraform state uchun S3 bucket: versiyalangan, shifrlangan, faqat TLS.
#   * GitHub Actions OIDC provider — CI deploy role'lari (modules/cell/deploy.tf) shunga ishonadi.
#   cd infra/terraform/bootstrap && terraform init && terraform apply
terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
  }
}

provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = { Project = "matchup", ManagedBy = "terraform", Purpose = "terraform-state" }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "matchup-terraform-state-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]

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

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

# GitHub Actions OIDC: CI uzoq muddatli kalitsiz, har job uchun qisqa muddatli credential oladi.
# Hisobda bitta bo'ladi; qaysi repo / environment qaysi role'ni ola olishi role'ning trust policy'sida.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

output "github_oidc_provider_arn" {
  description = "envs/<env>/terraform.tfvars -> github_oidc_provider_arn"
  value       = aws_iam_openid_connect_provider.github.arn
}
