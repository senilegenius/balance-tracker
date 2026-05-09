output "api_gateway_url" {
  description = "Public URL for the app (API Gateway invoke URL)"
  value       = module.app.api_gateway_url
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing container images"
  value       = module.app.ecr_repository_url
}

output "lambda_function_name" {
  description = "Lambda function name (used by GitHub Actions to update code)"
  value       = module.app.lambda_function_name
}

output "app_url" {
  description = "App URL — custom domain if configured, otherwise API Gateway URL"
  value       = module.app.app_url
}
