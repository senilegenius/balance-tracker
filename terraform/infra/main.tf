# App infrastructure: Lambda, API Gateway, ECR, EventBridge scheduler, GitHub Actions OIDC.
#
# State is stored in the S3 backend created by terraform/bootstrap.
# See backends/ for per-environment backend config.
#
# Usage (sandbox):
#   export AWS_PROFILE=pers
#   terraform init -backend-config=backends/sandbox.hcl
#   terraform apply -var-file=environments/sandbox.tfvars
#   (terraform.tfvars in this directory is gitignored and supplies secrets + personal values)
#
# Usage (prd):
#   export AWS_PROFILE=pers
#   terraform init -backend-config=backends/prd.hcl
#   terraform apply -var-file=environments/prd.tfvars

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

# Provider targets the deployment account by assuming a role.
# The role ARN is supplied via terraform.tfvars (gitignored).
# AWS credentials for the base account come from AWS_PROFILE env var.
provider "aws" {
  region = var.aws_region

  assume_role {
    role_arn = var.target_role_arn
  }
}

data "aws_caller_identity" "current" {}
