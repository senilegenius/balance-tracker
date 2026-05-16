# ── Deployment target ────────────────────────────────────────────────────────

variable "target_role_arn" {
  description = "IAM role ARN to assume in the sandbox AWS account"
  type        = string
  sensitive   = true
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-west-2"
}

variable "ecr_repository_url" {
  description = "ECR repository URL for the app image (from the central management account)"
  type        = string
}

# ── Application config ────────────────────────────────────────────────────────

variable "plaid_env" {
  description = "Plaid environment (sandbox or production)"
  type        = string
}

variable "node_env" {
  description = "NODE_ENV for the app (development or production)"
  type        = string
  default     = "production"
}

variable "allowed_origin" {
  description = "ALLOWED_ORIGIN for CORS — the URL the app is served from. Defaults to the API Gateway URL when not set."
  type        = string
  default     = null
}

variable "refresh_schedule" {
  description = "EventBridge Scheduler cron expression for Plaid balance refreshes (UTC)"
  type        = string
  default     = "cron(30 12 * * ? *)"
}

# ── Secrets ───────────────────────────────────────────────────────────────────

variable "database_url" {
  description = "PostgreSQL connection string (Supabase)"
  type        = string
  sensitive   = true
}

variable "plaid_client_id" {
  description = "Plaid client ID"
  type        = string
  sensitive   = true
}

variable "plaid_secret" {
  description = "Plaid secret key"
  type        = string
  sensitive   = true
}

variable "session_secret" {
  description = "Express session secret (long random string)"
  type        = string
  sensitive   = true
}

variable "db_encryption_key" {
  description = "Encryption key for pgcrypto (DB_ENCRYPTION_KEY)"
  type        = string
  sensitive   = true
}

# ── Custom domain (optional) ──────────────────────────────────────────────────

variable "custom_domain" {
  description = "Custom domain for the app. Typically left unset for sandbox."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID for the custom domain. Required when custom_domain is set."
  type        = string
  default     = null
}
