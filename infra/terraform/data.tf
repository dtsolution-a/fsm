############ Secrets (generated here, never typed or committed) ############
resource "random_password" "db" {
  length  = 32
  special = false # keeps the password safe to embed in a connection URL
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "admin_seed" {
  length  = 20
  special = true
  # characters that are safe in shells and JSON
  override_special = "#%+-_=@"
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # sslmode=require: RDS PostgreSQL 16 enforces TLS
  secret_string = "postgresql://fsm:${random_password.db.result}@${aws_db_instance.main.address}:5432/fsm?schema=public&sslmode=require"
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/jwt-secret"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "admin_seed" {
  name                    = "${local.name}/admin-seed-password"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "admin_seed" {
  secret_id     = aws_secretsmanager_secret.admin_seed.id
  secret_string = random_password.admin_seed.result
}

############ Database (RDS PostgreSQL 16, private subnets) ############
resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "fsm"
  username = "fsm"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "21:00-22:00" # 02:30-03:30 IST
  maintenance_window         = "sun:22:00-sun:23:00"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"

  lifecycle {
    # engine_version drifts as AWS applies minor upgrades; do not fight it
    ignore_changes = [engine_version]
  }
}

############ Container registries ############
resource "aws_ecr_repository" "backend" {
  name                 = "${local.name}/backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "web" {
  name                 = "${local.name}/web"
  image_tag_mutability = "MUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
}

locals {
  ecr_lifecycle = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 15 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 15 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy     = local.ecr_lifecycle
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle
}

############ Optional SSM-only bastion (for importing data into the private DB) ############
data "aws_ssm_parameter" "al2023_arm" {
  count = var.create_bastion ? 1 : 0
  name  = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bastion" {
  count              = var.create_bastion ? 1 : 0
  name               = "${local.name}-bastion"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  count      = var.create_bastion ? 1 : 0
  role       = aws_iam_role.bastion[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  count = var.create_bastion ? 1 : 0
  name  = "${local.name}-bastion"
  role  = aws_iam_role.bastion[0].name
}

resource "aws_instance" "bastion" {
  count                       = var.create_bastion ? 1 : 0
  ami                         = data.aws_ssm_parameter.al2023_arm[0].value
  instance_type               = "t4g.nano"
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.bastion[0].id]
  iam_instance_profile        = aws_iam_instance_profile.bastion[0].name
  associate_public_ip_address = true # outbound only, to reach the SSM service
  metadata_options {
    http_tokens = "required" # IMDSv2
  }
  root_block_device {
    encrypted = true
  }
  tags = { Name = "${local.name}-bastion" }
}

############ File storage (contract documents, later job photos) ############
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "files" {
  bucket = "${local.name}-files-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled" # an overwritten or deleted contract scan can be recovered
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Deny any non-TLS access
data "aws_iam_policy_document" "files_tls_only" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]
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

resource "aws_s3_bucket_policy" "files" {
  bucket = aws_s3_bucket.files.id
  policy = data.aws_iam_policy_document.files_tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.files]
}

############ Push notifications (OneSignal) - only when both values are provided ############
locals {
  push_enabled = var.onesignal_app_id != "" && var.onesignal_api_key != ""
}

resource "aws_secretsmanager_secret" "onesignal" {
  count                   = local.push_enabled ? 1 : 0
  name                    = "${local.name}/onesignal-api-key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "onesignal" {
  count         = local.push_enabled ? 1 : 0
  secret_id     = aws_secretsmanager_secret.onesignal[0].id
  secret_string = var.onesignal_api_key
}
