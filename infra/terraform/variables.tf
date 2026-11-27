variable "region" {
  description = "AWS region. ap-south-1 (Mumbai) is closest to the client."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  type    = string
  default = "fsm"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "certificate_arn" {
  description = "ACM certificate ARN (same region) to enable HTTPS. Leave empty to serve plain HTTP (testing only)."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Docker image tag to run for both services. deploy.sh passes the git/timestamp tag."
  type        = string
  default     = "latest"
}

# ---- sizing ----
variable "backend_cpu" {
  type    = number
  default = 512
}

variable "backend_memory" {
  type    = number
  default = 1024
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  description = "Tasks per service. Use 2+ for high availability."
  type        = number
  default     = 1
}

# ---- database ----
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "GB. Storage autoscaling is enabled up to db_max_allocated_storage."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  type    = number
  default = 100
}

variable "db_multi_az" {
  description = "Standby replica in another AZ (roughly doubles DB cost). Recommended for production."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

# ---- optional access helper ----
variable "create_bastion" {
  description = "Create a tiny SSM-only EC2 instance (no SSH, no inbound ports) used to reach the private database for data imports. Turn on when needed, off afterwards."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ---- push notifications (optional) ----
variable "onesignal_app_id" {
  description = "OneSignal App ID. Leave empty to run without push notifications."
  type        = string
  default     = ""
}

variable "onesignal_api_key" {
  description = "OneSignal REST API key (kept in Secrets Manager). Set together with onesignal_app_id. Pass via TF_VAR_onesignal_api_key rather than writing it in a file."
  type        = string
  default     = ""
  sensitive   = true
}
