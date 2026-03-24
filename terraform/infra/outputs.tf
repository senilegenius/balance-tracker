output "api_gateway_url" {
  description = "Public URL for the app (API Gateway invoke URL)"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing container images"
  value       = aws_ecr_repository.app.repository_url
}

output "lambda_function_name" {
  description = "Lambda function name (used by GitHub Actions to update code)"
  value       = aws_lambda_function.app.function_name
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions to assume via OIDC"
  value       = aws_iam_role.github_actions.arn
}
