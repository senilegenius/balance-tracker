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

resource "aws_lambda_function" "app" {
  function_name = "${var.app_name}-${var.environment}"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"

  image_uri = "${aws_ecr_repository.app.repository_url}:latest"

  timeout     = 30
  memory_size = 512

  environment {
    variables = {
      NODE_ENV          = var.node_env
      PLAID_ENV         = var.plaid_env
      ALLOWED_ORIGIN    = var.allowed_origin
      DATABASE_URL      = var.database_url
      PLAID_CLIENT_ID   = var.plaid_client_id
      PLAID_SECRET      = var.plaid_secret
      SESSION_SECRET    = var.session_secret
      DB_ENCRYPTION_KEY = var.db_encryption_key
    }
  }

  lifecycle {
    # Image URI is managed by GitHub Actions after initial creation.
    # Terraform manages configuration; CI/CD manages the deployed code.
    ignore_changes = [image_uri]
  }
}
