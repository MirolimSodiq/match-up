variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "route53_zone_id" {
  type = string
}

variable "api_domain" {
  type = string
}

variable "admin_domain" {
  type = string
}

variable "admin_allowed_cidrs" {
  type    = list(string)
  default = []
}

# Image teglari odatda berilmaydi: CI deploy ularni SSM'ga yozadi, Terraform o'sha yerdan o'qiydi.
# Birinchi o'rnatishda yoki favqulodda qo'lda deploy'da: -var api_image_tag=<git sha> (docs/DEPLOYMENT.md)
variable "api_image_tag" {
  type    = string
  default = null
}

variable "admin_image_tag" {
  type    = string
  default = null
}

variable "migrate_image_tag" {
  type    = string
  default = null
}

variable "media_worker_image_tag" {
  type    = string
  default = null
}

variable "github_oidc_provider_arn" {
  description = "bootstrap output github_oidc_provider_arn; null — CI deploy role yaratilmaydi"
  type        = string
  default     = null
}

variable "github_repository" {
  type    = string
  default = "MirolimSodiq/match-up"
}

variable "ops_telegram_chat_id" {
  description = "Host no-show ogohlantirishlari uchun Telegram ops guruhi id'si (masalan -1001234567890)"
  type        = string
  default     = null
}
