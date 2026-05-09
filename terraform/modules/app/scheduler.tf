resource "aws_iam_role" "scheduler" {
  name = "${var.app_name}-${var.environment}-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-lambda"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.app.arn
    }]
  })
}

# Triggers the Lambda on a schedule to refresh Plaid balances.
# The Lambda handler detects the scheduler event source and runs the refresh
# logic directly, independent of any HTTP request.
resource "aws_scheduler_schedule" "plaid_refresh" {
  name       = "${var.app_name}-${var.environment}-plaid-refresh"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.refresh_schedule
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.app.arn
    role_arn = aws_iam_role.scheduler.arn

    input = jsonencode({
      source       = "aws.scheduler"
      "detail-type" = "PlaidRefresh"
    })
  }
}
