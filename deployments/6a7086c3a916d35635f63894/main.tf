terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {
    bucket         = "infraflow-terraform-state-897722687806"
    key            = "deployments/6a7086c3a916d35635f63894/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "infraflow-terraform-locks"
    encrypt        = true
  }
}

variable "lambda_source_code_hashes" {
  type    = map(string)
  default = {}
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = {
      ManagedBy = "infraflow"
    }
  }
}

resource "aws_apigatewayv2_api" "rest_api_endpoint" {
  name          = "infraflow-rest-api-endpoint-6a7086c3a916d356"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_headers     = ["content-type", "authorization", "x-requested-with"]
    allow_methods     = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"]
    allow_origins     = ["https://d3pgg5abvvdatt.cloudfront.net", "http://127.0.0.1:5173", "http://localhost:5173", "https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com"]
    max_age           = 86400
  }

  lifecycle {
    ignore_changes = [cors_configuration]
  }
}

data "archive_file" "lambda_package" {
  type        = "zip"
  output_path = "${path.module}/lambda_package.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200, headers: { \"content-type\": \"application/json\" }, body: JSON.stringify({ ok: true }) });"
    filename = "index.js"
  }
}

resource "aws_lambda_function" "api_handler" {
  function_name    = "infraflow-api-handler-6a7086c3a916d356"
  role             = aws_iam_role.lambda_role.arn
  filename         = data.archive_file.lambda_package.output_path
  source_code_hash = data.archive_file.lambda_package.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 512
  timeout          = 30

}

resource "aws_dynamodb_table" "api_table" {
  name         = "infraflow-api-table-6a7086c3a916d356"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"


  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_iam_role" "lambda_role" {
  name               = "infraflow-lambda-role-6a7086c3a916d356"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_role_lambda_basic_execution" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_metric_alarm" "api_alarms" {
  alarm_name          = "infraflow-api-alarms-6a7086c3a916d356"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
}

resource "aws_apigatewayv2_integration" "template_edge_tpl_api_apigw_tpl_api_lambda" {
  api_id                 = aws_apigatewayv2_api.rest_api_endpoint.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api_handler.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "template_edge_tpl_api_apigw_tpl_api_lambda" {
  api_id    = aws_apigatewayv2_api.rest_api_endpoint.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.template_edge_tpl_api_apigw_tpl_api_lambda.id}"
}

resource "aws_cloudwatch_log_group" "template_edge_tpl_api_apigw_tpl_api_lambda_apigw_logs" {
  name              = "/aws/apigateway/infraflow-rest_api_endpoint-template_edge_tpl_api_apigw_tpl_api_lambda-6a7086c3a916d356"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "template_edge_tpl_api_apigw_tpl_api_lambda" {
  api_id      = aws_apigatewayv2_api.rest_api_endpoint.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.template_edge_tpl_api_apigw_tpl_api_lambda_apigw_logs.arn
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      protocol           = "$context.protocol"
      responseLength     = "$context.responseLength"
      integrationError   = "$context.integrationErrorMessage"
      authorizerError    = "$context.authorizer.error"
    })
  }
}

resource "aws_lambda_permission" "template_edge_tpl_api_apigw_tpl_api_lambda" {
  statement_id  = "AllowApiGatewayInvoketemplate_edge_tpl_api_apigw_tpl_api_lambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest_api_endpoint.execution_arn}/*/*"
}

output "infraflow_resource_outputs" {
  description = "Resource identifiers, ARNs, endpoints, and connectivity values generated by infraflow."
  value = {
    rest_api_endpoint = {
      label = "REST API endpoint"
      service = "API Gateway"
      service_id = "apigw"
      node_id = "tpl-api-apigw"
      terraform_address = "aws_apigatewayv2_api.rest_api_endpoint"
      id = try(aws_apigatewayv2_api.rest_api_endpoint.id, null)
      api_endpoint = try(aws_apigatewayv2_api.rest_api_endpoint.api_endpoint, null)
      execution_arn = try(aws_apigatewayv2_api.rest_api_endpoint.execution_arn, null)
    }
    api_handler = {
      label = "API handler"
      service = "Lambda"
      service_id = "lambda"
      node_id = "tpl-api-lambda"
      terraform_address = "aws_lambda_function.api_handler"
      arn = try(aws_lambda_function.api_handler.arn, null)
      invoke_arn = try(aws_lambda_function.api_handler.invoke_arn, null)
      function_name = try(aws_lambda_function.api_handler.function_name, null)
      qualified_arn = try(aws_lambda_function.api_handler.qualified_arn, null)
      version = try(aws_lambda_function.api_handler.version, null)
    }
    api_table = {
      label = "API table"
      service = "DynamoDB"
      service_id = "dynamodb"
      node_id = "tpl-api-dynamodb"
      terraform_address = "aws_dynamodb_table.api_table"
      arn = try(aws_dynamodb_table.api_table.arn, null)
      id = try(aws_dynamodb_table.api_table.id, null)
      stream_arn = try(aws_dynamodb_table.api_table.stream_arn, null)
    }
    lambda_role = {
      label = "Lambda role"
      service = "IAM Role"
      service_id = "iam"
      node_id = "tpl-api-iam"
      terraform_address = "aws_iam_role.lambda_role"
      arn = try(aws_iam_role.lambda_role.arn, null)
      name = try(aws_iam_role.lambda_role.name, null)
      unique_id = try(aws_iam_role.lambda_role.unique_id, null)
    }
    api_alarms = {
      label = "API alarms"
      service = "CloudWatch"
      service_id = "cloudwatch"
      node_id = "tpl-api-cloudwatch"
      terraform_address = "aws_cloudwatch_metric_alarm.api_alarms"
      arn = try(aws_cloudwatch_metric_alarm.api_alarms.arn, null)
      id = try(aws_cloudwatch_metric_alarm.api_alarms.id, null)
    }
  }
}