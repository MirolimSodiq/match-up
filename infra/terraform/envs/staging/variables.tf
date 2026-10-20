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

variable "api_image_tag" {
  description = "Deploy: -var api_image_tag=<git sha>"
  type        = string
}

variable "admin_image_tag" {
  type = string
}

variable "migrate_image_tag" {
  description = "Deploy 1-qadami: -var migrate_image_tag=<yangi sha> (api hali eski tegda)"
  type        = string
  default     = null
}
