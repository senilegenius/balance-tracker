# Infrastructure

The app runs on AWS Lambda + API Gateway. Infrastructure is managed with Terraform. CI/CD is handled by GitHub Actions. Terraform state is stored in S3 with DynamoDB locking.

## Architecture

```
GitHub Actions → ECR (container images)
                → Lambda (runs the app)
API Gateway    → Lambda
EventBridge    → Lambda (scheduled Plaid balance refreshes)
```

Secrets are passed as Lambda environment variables. No secrets are committed to git — use the `*.example` files as templates.

## Module layout

```
terraform/
├── bootstrap/        # One-time setup: S3 state bucket + DynamoDB lock table
├── modules/
│   └── app/          # All resource definitions: Lambda, API Gateway, IAM, scheduler
├── sandbox/          # Thin wrapper for sandbox account
└── prd/              # Thin wrapper for prd account
```

Each environment directory has its own backend config and is initialized independently — no `-reconfigure` needed when switching between environments.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.0
- AWS CLI with profiles configured for your management and target accounts
- Docker (for building Lambda images locally)
- A PostgreSQL database per environment (e.g. Supabase free tier)

---

## Step 1 — Bootstrap (one-time)

Creates the S3 bucket and DynamoDB table used as the Terraform remote backend for all environments. Runs against your management account and stores its own state locally.

```bash
cd terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars
# Fill in: aws_region, state_bucket_name (include your account ID for uniqueness)

export AWS_PROFILE=<your-management-account-profile>
terraform init
terraform apply
```

This only needs to be run once. The bucket and table persist permanently.

---

## Step 2 — Deploy infrastructure to an environment

```bash
cd terraform/sandbox   # or terraform/prd

# 1. Create your backend config from the example
cp backend.hcl.example backend.hcl
# Fill in: bucket (your state bucket name from Step 1)

# 2. Create your config + secrets file
cp terraform.tfvars.example terraform.tfvars
# Fill in: target_role_arn, ecr_repository_url, and all app secrets

# 3. Init (once per directory — no -reconfigure needed when switching environments)
export AWS_PROFILE=<your-management-account-profile>
terraform init -backend-config=backend.hcl

# 4. Plan, then apply
terraform plan
terraform apply
```

---

## Step 3 — Set up GitHub Actions

1. Create a `sandbox` environment in your GitHub repo (Settings → Environments)
2. Add secrets `AWS_ECR_PUSH_ROLE_ARN` and `AWS_DEPLOY_ROLE_ARN` from infrabase Terraform outputs
3. Push to `main` — the workflow builds the Lambda image, pushes to ECR, and deploys automatically

For prd, repeat with a `prd` environment once prd infrastructure is deployed.

---

## Tear down

```bash
cd terraform/sandbox   # or terraform/prd
export AWS_PROFILE=<your-management-account-profile>
terraform plan  # review what will be destroyed
terraform destroy
```

State is preserved in S3 even after destroy, so re-applying later works cleanly.

---

## File reference

```
bootstrap/
  main.tf                  # S3 bucket + DynamoDB table for Terraform state
  variables.tf
  terraform.tfvars.example # Template — copy to terraform.tfvars and fill in

modules/app/
  providers.tf             # Provider requirements including aws.dns alias
  variables.tf             # All input variables
  outputs.tf               # API Gateway URL, ECR URL, function name
  lambda.tf                # Lambda function and IAM execution role
  apigateway.tf            # API Gateway HTTP API
  custom_domain.tf         # ACM cert, Route53 records, API GW custom domain (optional)
  scheduler.tf             # EventBridge Scheduler for Plaid refreshes

sandbox/                   # prd/ is identical in structure
  main.tf                  # Provider config + module call
  variables.tf             # Input variables (passed through to module)
  outputs.tf               # Pass-through outputs from module
  backend.hcl.example      # Template — copy to backend.hcl and fill in
  backend.hcl              # Your actual backend config (gitignored)
  terraform.tfvars.example # Template — copy to terraform.tfvars and fill in
  terraform.tfvars         # Your actual config + secrets (gitignored)
```
