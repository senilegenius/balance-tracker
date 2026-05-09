# App infrastructure for the sandbox account.
# Calls modules/app — resource definitions live there.
#
# Credentials: set AWS_PROFILE to your management account profile — Terraform
# assumes target_role_arn to create resources in the sandbox account.
#
# Usage:
#   export AWS_PROFILE=<your-mgmt-profile>
#   cp backend.hcl.example backend.hcl            # fill in real values
#   cp terraform.tfvars.example terraform.tfvars  # fill in real values
#   terraform init -backend-config=backend.hcl
#   terraform plan
#   terraform apply

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  assume_role {
    role_arn = var.target_role_arn
  }

  default_tags {
    tags = {
      ManagedBy   = "terraform"
      Repo        = "balance-tracker"
      Environment = "sandbox"
    }
  }
}

provider "aws" {
  alias  = "dns"
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "terraform"
      Repo        = "balance-tracker"
      Environment = "mgmt"
    }
  }
}

module "app" {
  source = "../modules/app"

  providers = {
    aws     = aws
    aws.dns = aws.dns
  }

  environment        = "sandbox"
  app_name           = "balance-tracker"
  aws_region         = var.aws_region
  ecr_repository_url = var.ecr_repository_url
  plaid_env          = var.plaid_env
  node_env           = var.node_env
  allowed_origin     = var.allowed_origin
  refresh_schedule   = var.refresh_schedule
  database_url       = var.database_url
  plaid_client_id    = var.plaid_client_id
  plaid_secret       = var.plaid_secret
  session_secret     = var.session_secret
  db_encryption_key  = var.db_encryption_key
  custom_domain      = var.custom_domain
  route53_zone_id    = var.route53_zone_id
}
