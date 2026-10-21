output "api_url" {
  value = "https://${var.api_domain}"
}

output "admin_url" {
  value = "https://${var.admin_domain}"
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecr_repositories" {
  description = "docker push manzillari"
  value       = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  description = "aws ecs run-task --task-definition <shu>"
  value       = aws_ecs_task_definition.migrate.family
}

output "migrate_network" {
  description = "run-task uchun --network-configuration qiymatlari"
  value = {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.api.id]
  }
}

output "secret_arns" {
  description = "Qo'lda to'ldiriladigan secret'lar (docs/DEPLOYMENT.md)"
  value       = { for k, s in aws_secretsmanager_secret.manual : k => s.arn }
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "media_raw_bucket" {
  value = aws_s3_bucket.media_raw.bucket
}

output "media_worker_service" {
  value = aws_ecs_service.media_worker["default"].name
}

output "media_recording_worker_service" {
  value = aws_ecs_service.media_worker["recording"].name
}

output "media_cdn_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}
