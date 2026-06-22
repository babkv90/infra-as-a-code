provider "aws" {
  region = "ap-south-1"
}

resource "aws_vpc" "prod" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "prod-vpc"
  }
}

resource "aws_internet_gateway" "prod" {
  vpc_id = aws_vpc.prod.id

  tags = {
    Name = "prod-igw"
  }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.40.1.0/24"
  availability_zone       = "ap-south-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "public-a"
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.40.2.0/24"
  availability_zone       = "ap-south-1b"
  map_public_ip_on_launch = true

  tags = {
    Name = "public-b"
  }
}

resource "aws_subnet" "private_a" {
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.40.11.0/24"
  availability_zone       = "ap-south-1a"
  map_public_ip_on_launch = false

  tags = {
    Name = "private-a"
  }
}

resource "aws_subnet" "private_b" {
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.40.12.0/24"
  availability_zone       = "ap-south-1b"
  map_public_ip_on_launch = false

  tags = {
    Name = "private-b"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.prod.id

  tags = {
    Name = "public-rt"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.prod.id

  tags = {
    Name = "private-rt"
  }
}

resource "aws_nat_gateway" "public_a" {
  subnet_id         = aws_subnet.public_a.id
  connectivity_type = "public"

  tags = {
    Name = "nat-public-a"
  }
}

resource "aws_security_group" "alb" {
  name        = "alb-sg"
  description = "Internet ingress to ALB"
  vpc_id      = aws_vpc.prod.id
}

resource "aws_security_group" "app" {
  name        = "app-sg"
  description = "Application service security group"
  vpc_id      = aws_vpc.prod.id
}

resource "aws_security_group" "data" {
  name        = "data-sg"
  description = "Data tier security group"
  vpc_id      = aws_vpc.prod.id
}

resource "aws_wafv2_web_acl" "edge" {
  name        = "edge-waf"
  scope       = "REGIONAL"
  description = "Regional WAF for public entry points"

  default_action {
    allow {}
  }
}

resource "aws_route53_record" "app" {
  zone_id = "Z0123456789EXAMPLE"
  name    = "app.example.com"
  type    = "A"
  ttl     = 60
  records = [aws_lb.public.dns_name]
}

resource "aws_s3_bucket" "web_assets" {
  bucket = "web-assets-prod"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "web-cdn"
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
}

resource "aws_lb" "public" {
  name               = "public-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "app" {
  name     = "app-targets"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.prod.id
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.public.arn
  port              = 443
  protocol          = "HTTPS"
  target_group_arn  = aws_lb_target_group.app.arn
}

resource "aws_iam_role" "app_task" {
  name               = "app-task-role"
  assume_role_policy = "{}"
}

resource "aws_iam_role" "lambda_exec" {
  name               = "lambda-exec-role"
  assume_role_policy = "{}"
}

resource "aws_ecs_service" "orders" {
  name            = "orders-api"
  cluster         = "prod-cluster"
  task_definition = aws_iam_role.app_task.arn
  desired_count   = 6
  launch_type     = "FARGATE"
}

resource "aws_lambda_function" "billing_worker" {
  function_name    = "billing-worker"
  role_arn         = aws_iam_role.lambda_exec.arn
  filename         = "billing-worker.zip"
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 1024
  timeout          = 30
  source_code_hash = "filebase64sha256(\"billing-worker.zip\")"
}

resource "aws_apigatewayv2_api" "partner" {
  name          = "partner-api"
  protocol_type = "HTTP"
  target        = aws_lambda_function.billing_worker.invoke_arn
}

resource "aws_sqs_queue" "orders_events" {
  name                       = "orders-events"
  fifo_queue                 = false
  visibility_timeout_seconds = 60
}

resource "aws_sns_topic" "billing" {
  name = "billing-topic"
}

resource "aws_cloudwatch_event_rule" "nightly_jobs" {
  name                = "nightly-jobs"
  schedule_expression = "rate(1 day)"
}

resource "aws_db_instance" "orders" {
  identifier          = "orders-db"
  engine              = "postgres"
  instance_class      = "db.r6g.large"
  allocated_storage   = 100
  username            = "app"
  password            = aws_secretsmanager_secret.db.arn
  db_name             = "orders"
  skip_final_snapshot = true
}

resource "aws_dynamodb_table" "sessions" {
  name         = "session-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id      = "redis-cache"
  engine          = "redis"
  node_type       = "cache.t4g.medium"
  num_cache_nodes = 1
  port            = 6379
}

resource "aws_kms_key" "platform" {
  description         = "Platform encryption key"
  key_usage           = "ENCRYPT_DECRYPT"
  enable_key_rotation = true
}

resource "aws_secretsmanager_secret" "db" {
  name        = "db-credentials"
  description = "Database credentials consumed by app services"
}

resource "aws_cloudwatch_metric_alarm" "platform" {
  alarm_name          = "platform-alarms"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
}

resource "aws_ecr_repository" "orders_api" {
  name                 = "orders-api-repo"
  image_tag_mutability = "IMMUTABLE"
  scan_on_push         = true
}

resource "aws_codebuild_project" "orders" {
  name         = "orders-build"
  service_role = aws_iam_role.app_task.arn
  compute_type = "BUILD_GENERAL1_MEDIUM"
  image        = "aws/codebuild/standard:7.0"
  type         = "LINUX_CONTAINER"
}

resource "aws_codepipeline" "prod" {
  name          = "prod-release"
  role_arn      = aws_iam_role.app_task.arn
  pipeline_type = "V2"
}
