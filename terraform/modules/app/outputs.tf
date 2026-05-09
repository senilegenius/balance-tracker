output "api_gateway_url" {
  description = "Public URL for the app (API Gateway invoke URL)"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing container images"
  value       = var.ecr_repository_url
}

output "lambda_function_name" {
  description = "Lambda function name (used by GitHub Actions to update code)"
  value       = aws_lambda_function.app.function_name
}

output "app_url" {
  description = "App URL — custom domain if configured, otherwise API Gateway URL"
  value       = var.custom_domain != null ? "https://${var.custom_domain}" : aws_apigatewayv2_stage.default.invoke_url
}

