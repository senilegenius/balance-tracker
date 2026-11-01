resource "aws_apigatewayv2_api" "app" {
  name          = "${var.app_name}-${var.environment}"
  protocol_type = "HTTP"

  # With a custom domain, the default execute-api URL is just a second way in.
  # Environments without one (e.g. sandbox) still need it.
  disable_execute_api_endpoint = var.custom_domain != null
}

# Access log: one JSON line per request (client IP, path, status, user agent)
resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.app_name}-${var.environment}"
  retention_in_days = 90
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      time             = "$context.requestTime"
      ip               = "$context.identity.sourceIp"
      method           = "$context.httpMethod"
      path             = "$context.path"
      status           = "$context.status"
      bytes            = "$context.responseLength"
      latencyMs        = "$context.responseLatency"
      userAgent        = "$context.identity.userAgent"
      domain           = "$context.domainName"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.app.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
}
