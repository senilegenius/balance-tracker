# ── Deployment target ────────────────────────────────────────────────────────

variable "target_role_arn" {
  description = "IAM role ARN to assume in the target AWS account (sandbox or prd)"
  type        = string
  sensitive   = true
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (sandbox or prd)"
  type        = string
}

variable "app_name" {
  description = "Application name used as a prefix for all resource names"
  type        = string
  default     = "balance-tracker"
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
  default     = "cron(0 12,18,0 * * ? *)"
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
