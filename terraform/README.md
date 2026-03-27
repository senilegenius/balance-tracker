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
cd terraform/infra

# 1. Create your backend config from the example (contains your state bucket name)
cp backends/sandbox.hcl.example backends/sandbox.hcl
# Fill in: bucket (your state bucket name from Step 1)

# 2. Create your secrets + personal config (never committed)
cp terraform.tfvars.example terraform.tfvars
# Fill in: target_role_arn, github_repo, allowed_origin, and all app secrets

# 3. Init pointing at your backend
export AWS_PROFILE=<your-management-account-profile>
terraform init -backend-config=backends/sandbox.hcl

# 4. Apply
terraform apply -var-file=environments/sandbox.tfvars
```

After the first apply, copy the `api_gateway_url` output into `terraform.tfvars` as `allowed_origin` (no trailing slash), then re-apply to update the Lambda's CORS config.

To deploy to prd, repeat using `backends/prd.hcl` and `environments/prd.tfvars`.

---

## Step 3 — Set up GitHub Actions

1. Create a `sandbox` environment in your GitHub repo (Settings → Environments)
2. Add a secret named `AWS_ROLE_ARN` with the value of the `github_actions_role_arn` Terraform output
3. Push to `main` — the workflow builds the Lambda image, pushes to ECR, and deploys automatically

For prd, repeat with a `prd` environment and the prd role ARN once prd infrastructure is deployed.

---

## Tear down

```bash
cd terraform/infra
export AWS_PROFILE=<your-management-account-profile>
terraform destroy -var-file=environments/sandbox.tfvars
```

State is preserved in S3 even after destroy, so re-applying later works cleanly.

---

## File reference

```
bootstrap/
  main.tf                  # S3 bucket + DynamoDB table for Terraform state
  variables.tf
  terraform.tfvars.example # Template — copy to terraform.tfvars and fill in

infra/
  main.tf                  # Provider config and S3 backend
  variables.tf             # All input variables
  outputs.tf               # API Gateway URL, ECR URL, role ARN, function name
  ecr.tf                   # ECR repository and lifecycle policy
  lambda.tf                # Lambda function and IAM execution role
  apigateway.tf            # API Gateway HTTP API
  scheduler.tf             # EventBridge Scheduler for Plaid refreshes
  iam_github.tf            # GitHub Actions OIDC provider and deploy role

  backends/
    sandbox.hcl.example    # Template — copy to sandbox.hcl and fill in
    prd.hcl.example        # Template — copy to prd.hcl and fill in
    *.hcl                  # Your actual backend configs (gitignored)

  environments/
    sandbox.tfvars         # Non-sensitive sandbox config (committed)
    prd.tfvars             # Non-sensitive prd config (committed)

  terraform.tfvars.example # Template for secrets + personal values
  terraform.tfvars         # Your actual secrets (gitignored)
```
