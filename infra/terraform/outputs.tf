output "app_url" {
  description = "Open this (or point your domain's DNS at alb_dns_name)."
  value       = local.https_enabled ? "https://${aws_lb.main.dns_name}" : "http://${aws_lb.main.dns_name}"
}

output "alb_dns_name" {
  description = "Create a DNS alias/CNAME for your domain pointing here."
  value       = aws_lb.main.dns_name
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_web_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "seed_task_definition" {
  value = aws_ecs_task_definition.seed.family
}

output "app_subnet_ids_csv" {
  value = join(",", aws_subnet.public[*].id)
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "database_url_secret_arn" {
  description = "Connection string secret (contains the DB password). Fetch with: aws secretsmanager get-secret-value --secret-id <arn>"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "admin_password_secret_arn" {
  description = "First admin login password. User ID is: Admin"
  value       = aws_secretsmanager_secret.admin_seed.arn
}

output "bastion_instance_id" {
  value = var.create_bastion ? aws_instance.bastion[0].id : null
}

output "aws_region" {
  value = var.region
}

output "log_group_prefix" {
  value = "/ecs/${local.name}"
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}
