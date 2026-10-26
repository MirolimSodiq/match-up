# -----------------------------------------------------------------------------
# Umumiy
# -----------------------------------------------------------------------------
variable "name" {
  description = "Resurs nomlari prefiksi, masalan matchup-staging"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.name))
    error_message = "name: kichik harf, raqam va '-' (3-25 belgi)."
  }
}

variable "environment" {
  description = "staging | prod"
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment: staging yoki prod."
  }
}

variable "allowed_regions" {
  description = "Data residency (docs/ARCHITECTURE.md §4.3): UZ foydalanuvchilari ma'lumotlari faqat shu regionlarda"
  type        = list(string)
  default     = ["eu-central-1"]
}

# -----------------------------------------------------------------------------
# Tarmoq
# -----------------------------------------------------------------------------
variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  description = "Availability zone'lar soni (public + private subnet har birida)"
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2
    error_message = "ALB va RDS Multi-AZ kamida 2 AZ talab qiladi."
  }
}

variable "single_nat_gateway" {
  description = "true — bitta NAT (staging, arzon); false — har AZ'da NAT (prod, AZ nosozligiga chidamli)"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Domen, TLS, kirish
# -----------------------------------------------------------------------------
variable "route53_zone_id" {
  description = "api_domain va admin_domain joylashgan Route53 hosted zone (ACM DNS validatsiyasi va alias yozuvlar)"
  type        = string
}

variable "api_domain" {
  description = "Masalan api.staging.matchup.uz"
  type        = string
}

variable "admin_domain" {
  description = "Masalan admin.staging.matchup.uz"
  type        = string
}

variable "admin_allowed_cidrs" {
  description = "Admin panelga faqat shu IP'lardan kirish (ALB qoidasi, maks. 5 ta). Bo'sh — hamma joydan (OTP + admin roli baribir talab qilinadi)"
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.admin_allowed_cidrs) <= 5
    error_message = "ALB source_ip sharti ko'pi bilan 5 ta CIDR qabul qiladi."
  }
}

variable "alb_idle_timeout" {
  description = "Soniyalarda. WebSocket ulanishlari uchun 60 dan uzunroq"
  type        = number
  default     = 120
}

# -----------------------------------------------------------------------------
# ECS Fargate
# -----------------------------------------------------------------------------
variable "cpu_architecture" {
  description = "ARM64 (Graviton, arzonroq) yoki X86_64. Image'lar shu platformada build qilinishi kerak"
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["ARM64", "X86_64"], var.cpu_architecture)
    error_message = "cpu_architecture: ARM64 yoki X86_64."
  }
}

variable "use_fargate_spot" {
  description = "Servislar FARGATE_SPOT'da (staging uchun arzon; prod'da false)"
  type        = bool
  default     = false
}

variable "enable_execute_command" {
  description = "ECS Exec (aws ecs execute-command) — debug uchun; prod'da odatda false"
  type        = bool
  default     = false
}

# Image teglari: odatda null — joriy teg SSM'dan (`/<name>/image-tags/*`, CI deploy yozadi; deploy.tf).
# Berilsa SSM'dan ustun (birinchi o'rnatish yoki favqulodda qo'lda deploy); keyingi CI deploy uni almashtiradi.
variable "api_image_tag" {
  description = "ECR'dagi api image tegi (git SHA); null — SSM'dagi oxirgi deploy qilingan teg"
  type        = string
  default     = null
}

variable "admin_image_tag" {
  description = "ECR'dagi admin image tegi (git SHA); null — SSM'dagi oxirgi deploy qilingan teg"
  type        = string
  default     = null
}

variable "migrate_image_tag" {
  description = "Migratsiya task'i image tegi; null — SSM (CI deploy migratsiyadan oldin yangilaydi), u ham bo'lmasa api tegi"
  type        = string
  default     = null
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "api_min_count" {
  type    = number
  default = 2
}

variable "api_max_count" {
  type    = number
  default = 6
}

variable "admin_cpu" {
  type    = number
  default = 256
}

variable "admin_memory" {
  type    = number
  default = 512
}

variable "admin_desired_count" {
  type    = number
  default = 1
}

variable "api_environment" {
  description = "API uchun qo'shimcha oddiy (maxfiy bo'lmagan) env, masalan PAYME_CHECKOUT_URL"
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  type    = number
  default = 90
}

# -----------------------------------------------------------------------------
# PostgreSQL (RDS)
# -----------------------------------------------------------------------------
variable "db_engine_version" {
  description = "Major versiya; minor'lar avtomatik yangilanadi"
  type        = string
  default     = "18"
}

variable "db_instance_class" {
  type    = string
  default = "db.m7g.large"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling yuqori chegarasi (GB)"
  type        = number
  default     = 500
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_backup_retention_days" {
  description = "PITR oynasi (kun). Privacy policy'dagi backup muddati bilan mos bo'lsin (ARCHITECTURE §4.8: 35)"
  type        = number
  default     = 35
}

variable "db_password_version" {
  description = "DB master paroli (write-only, state'ga yozilmaydi). Rotatsiya: qiymatni 1 ga oshirib apply"
  type        = number
  default     = 1
}

variable "deletion_protection" {
  description = "RDS va ALB uchun o'chirishdan himoya"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Valkey (ElastiCache)
# -----------------------------------------------------------------------------
variable "cache_engine_version" {
  type    = string
  default = "8.1"
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "cache_node_count" {
  description = "1 — faqat primary; 2+ — replica'lar, avtomatik failover va Multi-AZ"
  type        = number
  default     = 2
}

# -----------------------------------------------------------------------------
# Media (S3 + CloudFront)
# -----------------------------------------------------------------------------
variable "media_raw_expiration_days" {
  description = "Xom videolar (media-raw bucket) shuncha kundan keyin o'chiriladi (ARCHITECTURE §4.10)"
  type        = number
  default     = 30
}

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_200"
}

variable "media_signing_public_key_pem" {
  description = "CloudFront signed URL'lar uchun public key (PEM). Berilsa — media faqat imzolangan URL bilan ochiladi"
  type        = string
  default     = null
}

variable "media_worker_image_tag" {
  description = "services/media-worker image tegi (git SHA); null — SSM'dagi oxirgi deploy qilingan teg"
  type        = string
  default     = null
}

variable "media_worker_cpu" {
  type    = number
  default = 1024
}

variable "media_worker_memory" {
  type    = number
  default = 2048
}

variable "media_worker_min_count" {
  type    = number
  default = 1
}

variable "media_worker_max_count" {
  type    = number
  default = 4
}

variable "media_recording_worker_cpu" {
  description = "To'liq o'yin yozuvi worker'i (4K HEVC dekodlash + 3 rendition)"
  type        = number
  default     = 4096
}

variable "media_recording_worker_memory" {
  type    = number
  default = 8192
}

variable "media_recording_worker_storage_gib" {
  description = "Fargate ephemeral storage: manba (≤ 40 GB) + HLS natijalari"
  type        = number
  default     = 120
}

variable "media_recording_worker_min_count" {
  description = "Bo'sh paytda yozuv worker'lari soni: 0 — navbat bo'sh bo'lsa task yo'q (backlog paydo bo'lsa ~2 daqiqada ko'tariladi)"
  type        = number
  default     = 0
}

variable "media_recording_worker_max_count" {
  type    = number
  default = 3
}

variable "media_recording_expiration_days" {
  description = "To'liq o'yin videosini ko'rish muddati, kun: API shundan keyin ko'rsatmaydi, HLS (media bucket, recordings/) bir kun keyin o'chiriladi (docs/AI_CAM.md §5)"
  type        = number
  default     = 90
}

variable "media_worker_token_version" {
  description = "MEDIA_WORKER_TOKEN (write-only). Rotatsiya: qiymatni 1 ga oshirib apply, keyin api va media-worker'ni qayta deploy"
  type        = number
  default     = 1
}

variable "github_oidc_provider_arn" {
  description = "bootstrap output `github_oidc_provider_arn`. null — CI deploy role yaratilmaydi"
  type        = string
  default     = null
}

variable "github_repository" {
  description = "Deploy qila oladigan repo (`owner/name`); trust policy: faqat shu repo'ning `github_environment` environment'idagi job'lari"
  type        = string
  default     = null
}

variable "github_environment" {
  description = "GitHub Environment nomi (workflow'dagi `environment:`); null — var.environment"
  type        = string
  default     = null
}

variable "ops_telegram_chat_id" {
  description = "Host no-show ogohlantirishlari uchun Telegram ops guruhi (OPS_TELEGRAM_CHAT_ID); bot tokeni — `telegram` secret'ida"
  type        = string
  default     = null
}

variable "cache_auth_token_version" {
  description = "Valkey AUTH token (write-only). Rotatsiya: qiymatni 1 ga oshirib apply"
  type        = number
  default     = 1
}
