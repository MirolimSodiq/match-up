# Match Up region cell'i: bitta to'liq mustaqil stack (ARCHITECTURE §4.3 — cell pattern).
# MVP: uz-1 -> AWS eu-central-1. Yangi muhit/cell = shu modulni boshqa envs/<nom> dan chaqirish.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  azs        = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  is_prod = var.environment == "prod"

  api_port   = 3000
  admin_port = 3100

  # Ichki DNS: admin (BFF) API'ga ALB'siz, to'g'ridan-to'g'ri murojaat qiladi
  service_namespace = "${var.name}.internal"
  api_internal_url  = "http://api.${local.service_namespace}:${local.api_port}"
}

# Data residency: shaxsiy ma'lumotlar faqat ruxsat etilgan regionda (Germaniya — UZ adekvat ro'yxatida)
resource "terraform_data" "region_guard" {
  input = local.region

  lifecycle {
    precondition {
      condition     = contains(var.allowed_regions, local.region)
      error_message = "Region ${local.region} ruxsat etilmagan (allowed_regions). Qarang: docs/ARCHITECTURE.md §4.3."
    }
  }
}
