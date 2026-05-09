locals {
  allowed_origin = var.allowed_origin != null ? var.allowed_origin : "https://${aws_apigatewayv2_api.app.id}.execute-api.${var.aws_region}.amazonaws.com"

  # Derive the ECR repository ARN from the repository URL.
  # URL format: {account_id}.dkr.ecr.{region}.amazonaws.com/{repo_name}
  ecr_account_id     = split(".", var.ecr_repository_url)[0]
  ecr_repo_name      = split("/", var.ecr_repository_url)[1]
  ecr_repository_arn = "arn:aws:ecr:${var.aws_region}:${local.ecr_account_id}:repository/${local.ecr_repo_name}"
}

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-${var.environment}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_ecr_pull" {
  name = "ecr-pull"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ECRPull"
      Effect = "Allow"
      Action = [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
      ]
      Resource = local.ecr_repository_arn
    }]
  })
}

resource "aws_lambda_function" "app" {
  function_name = "${var.app_name}-${var.environment}"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"

  image_uri = "${var.ecr_repository_url}:latest"

  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      NODE_ENV             = var.node_env
      PLAID_ENV            = var.plaid_env
      ALLOWED_ORIGIN       = local.allowed_origin
      DATABASE_URL         = var.database_url
      PLAID_CLIENT_ID      = var.plaid_client_id
      PLAID_SECRET         = var.plaid_secret
      SESSION_SECRET       = var.session_secret
      DB_ENCRYPTION_KEY    = var.db_encryption_key
      NODE_EXTRA_CA_CERTS  = "/var/task/certs/prod-ca-2021.crt"
    }
  }

  lifecycle {
    # Image URI is managed by GitHub Actions after initial creation.
    # Terraform manages configuration; CI/CD manages the deployed code.
    ignore_changes = [image_uri]
  }
}
