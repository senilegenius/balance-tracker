# Custom domain support — all resources are conditional on var.custom_domain being set.
# Set custom_domain and route53_zone_id in your environment's .tfvars file (gitignored).
# Leave both unset for sandbox.

# ── ACM certificate (prd account, same region as API Gateway) ─────────────────

resource "aws_acm_certificate" "custom_domain" {
  count             = var.custom_domain != null ? 1 : 0
  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ── DNS validation records (management account — holds Route53 zone) ──────────

resource "aws_route53_record" "cert_validation" {
  for_each = var.custom_domain != null ? {
    for dvo in aws_acm_certificate.custom_domain[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  provider = aws.dns
  zone_id  = var.route53_zone_id
  name     = each.value.name
  type     = each.value.type
  records  = [each.value.record]
  ttl      = 60
}

resource "aws_acm_certificate_validation" "custom_domain" {
  count           = var.custom_domain != null ? 1 : 0
  certificate_arn = aws_acm_certificate.custom_domain[0].arn
  validation_record_fqdns = [
    for record in aws_route53_record.cert_validation : record.fqdn
  ]
}

# ── API Gateway custom domain (prd account) ───────────────────────────────────

resource "aws_apigatewayv2_domain_name" "custom" {
  count       = var.custom_domain != null ? 1 : 0
  domain_name = var.custom_domain

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.custom_domain[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "custom" {
  count       = var.custom_domain != null ? 1 : 0
  api_id      = aws_apigatewayv2_api.app.id
  domain_name = aws_apigatewayv2_domain_name.custom[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

# ── Route53 A record → API Gateway custom domain (management account) ─────────

resource "aws_route53_record" "custom_domain" {
  count    = var.custom_domain != null ? 1 : 0
  provider = aws.dns
  zone_id  = var.route53_zone_id
  name     = var.custom_domain
  type     = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
