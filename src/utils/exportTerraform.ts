import { latestAmazonLinux2023Ami, serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode, NodeBinding } from '../types';
import { expectedOutputsForService } from './resourceRequirements';

export function exportTerraform(nodes: AwsNode[], edges: AwsEdge[], selectedNodeId?: string): string {
  const targetNodes = selectedNodeId ? nodes.filter((node) => node.id === selectedNodeId) : nodes;
  const serviceNodes = targetNodes.filter((node) => node.type !== 'groupBox' && node.data.serviceId);
  const region = firstRegion(serviceNodes) ?? 'ap-south-1';
  const createsManagedEc2Keys = serviceNodes.some(shouldCreateManagedEc2KeyPair);
  const includesUsEast1Provider = serviceNodes.some(
    (node) =>
      (node.data.serviceId === 'waf' && configString(node.data.config, 'scope') === 'CLOUDFRONT') ||
      (node.data.serviceId === 'cloudwatch' && configString(node.data.config, 'namespace') === 'AWS/CloudFront'),
  );
  const resourceBlocks = dedupeTerraformBlocks([
    ...awsDataSourceBlocks(serviceNodes),
    ...ec2AmiDataBlocks(serviceNodes),
    ...ec2ManagedKeyPairBlocks(serviceNodes),
    ...bindingSupportBlocks(serviceNodes, nodes),
    ...ec2InstanceProfileBlocks(serviceNodes),
    ...serviceNodes.flatMap((node) => resourceBlocksForNode(node, nodes, edges)),
    resourceOutputBlock(serviceNodes),
  ]);

  if (selectedNodeId) {
    return [terraformHeader(region, createsManagedEc2Keys, includesUsEast1Provider), ...resourceBlocks].join('\n\n') || '# Select an AWS service node to export Terraform.';
  }

  const edgeNotes = edges.length
    ? `\n\n# Connections\n${edges
        .map((edge) => `# ${nodeName(nodes, edge.source)} -> ${nodeName(nodes, edge.target)} (${edge.data?.connectionType ?? 'data'}: ${edge.data?.label || 'unlabeled'})`)
        .join('\n')}`
    : '';

  return `${[terraformHeader(region, createsManagedEc2Keys, includesUsEast1Provider), ...resourceBlocks].join('\n\n') || '# Add nodes to generate Terraform.'}${edgeNotes}`;
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resource';
}

function sanitizeMetricName(value: string): string {
  return String(value || 'infraflowMetric').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'infraflowMetric';
}

function terraformHeader(region: string, includeTlsProvider = false, includeUsEast1Provider = false): string {
  return `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }${includeTlsProvider ? `
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }` : ''}
  }
}

provider "aws" {
  region = "${escapeString(region)}"
}${includeUsEast1Provider ? `

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}` : ''}`;
}

function ec2AmiDataBlocks(nodes: AwsNode[]): string[] {
  if (!nodes.some((node) => node.data.serviceId === 'ec2' && ec2AmiExpression(node.data.config) === latestAmazonLinux2023Ami)) return [];

  return [
    `data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}`,
  ];
}

function awsDataSourceBlocks(nodes: AwsNode[]): string[] {
  const configValues = nodes.flatMap((node) => Object.values(node.data.config ?? {}).map(String));
  const blocks: string[] = [];

  if (configValues.some((value) => value.includes('data.aws_vpc.default'))) {
    blocks.push(`data "aws_vpc" "default" {
  default = true
}`);
  }

  if (configValues.some((value) => value.includes('data.aws_subnets.default'))) {
    blocks.push(`data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}`);
  }

  return blocks;
}

function ec2ManagedKeyPairBlocks(nodes: AwsNode[]): string[] {
  return nodes.filter(shouldCreateManagedEc2KeyPair).flatMap((node) => {
    const label = node.data.label || node.data.serviceName;
    const resourceName = managedEc2KeyPairResourceName(sanitizeName(label));
    const keyName = uniqueAwsName(`${label}-key`);

    return [
      `resource "tls_private_key" "${resourceName}" {
  algorithm = "RSA"
  rsa_bits  = 4096
}`,
      `resource "aws_key_pair" "${resourceName}" {
  key_name   = ${formatValue(keyName)}
  public_key = tls_private_key.${resourceName}.public_key_openssh
}`,
    ];
  });
}

function ec2InstanceProfileBlocks(nodes: AwsNode[]): string[] {
  const roleEntries = new Map<string, string>();

  for (const node of nodes) {
    if (node.data.serviceId !== 'ec2') continue;
    if (node.data.config?.iam_instance_profile) continue;

    const roleArn = roleArnFromNode(node);
    const roleName = roleNameFromArn(roleArn);
    if (roleArn && roleName) roleEntries.set(roleName, roleArn);
  }

  return Array.from(roleEntries.entries()).flatMap(([roleName, roleArn]) => {
    const resourceName = sharedEc2ProfileResourceName(roleName);
    return [
      `# IAM role ARN: ${roleArn}
data "aws_iam_role" "${resourceName}_role" {
  name = ${formatValue(roleName)}
}`,
      `resource "aws_iam_instance_profile" "${resourceName}" {
  name = ${formatValue(`${uniqueAwsName(roleName)}-profile`)}
  role = data.aws_iam_role.${resourceName}_role.name
}`,
    ];
  });
}

function resourceBlocksForNode(node: AwsNode, allNodes: AwsNode[], edges: AwsEdge[]): string[] {
  const service = serviceById[node.data.serviceId ?? ''];
  const config = node.data.config ?? {};
  const label = node.data.label || node.data.serviceName;
  const name = sanitizeName(label);
  const awsName = configString(config, 'name') || uniqueAwsName(label);

  switch (node.data.serviceId) {
    case 'ec2': {
      const roleArn = roleArnFromNode(node);
      const roleName = roleArn ? roleNameFromArn(roleArn) : undefined;
      const instanceProfile = config.iam_instance_profile ? String(config.iam_instance_profile).trim() : '';
      const profileReference = instanceProfile
        ? formatValue(instanceProfile)
        : roleName
          ? `aws_iam_instance_profile.${sharedEc2ProfileResourceName(roleName)}.name`
          : undefined;
      const keyNameLine = configString(config, 'key_name')
        ? optionalLine('key_name', config.key_name)
        : `  key_name = aws_key_pair.${managedEc2KeyPairResourceName(name)}.key_name\n`;

      return [
        `resource "aws_instance" "${name}" {
  ami           = ${formatMaybeExpression(ec2AmiExpression(config))}
  instance_type = ${formatValue(configString(config, 'instance_type'))}
${keyNameLine}${optionalExpressionLine('subnet_id', config.subnet_id)}${ec2SecurityGroupIdsLine(node, allNodes, edges)}${optionalLine('associate_public_ip_address', config.associate_public_ip_address)}${profileReference ? `  iam_instance_profile = ${profileReference}\n` : ''}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    }
    case 'lambda': {
      const iamNode = connectedServiceNode(node, allNodes, edges, 'iam');
      const roleRef = configString(config, 'role_arn') ||
        (iamNode ? `aws_iam_role.${sanitizeName(iamNode.data.label || iamNode.data.serviceName)}.arn` : '');
      return [
        `resource "aws_lambda_function" "${name}" {
  function_name    = ${formatValue(configString(config, 'function_name') || awsName)}
  role             = ${formatMaybeExpression(roleRef)}
  filename         = ${formatValue(configString(config, 'filename'))}
  source_code_hash = ${formatMaybeExpression(configString(config, 'source_code_hash'))}
  handler          = ${formatValue(configString(config, 'handler'))}
  runtime          = ${formatValue(configString(config, 'runtime'))}
  memory_size      = ${formatNumber(config.memory_size)}
  timeout          = ${formatNumber(config.timeout)}
${lambdaEnvironmentBlock(node, allNodes)}
}`,
      ];
    }
    case 'ecs':
      return [
        `resource "aws_ecs_service" "${name}" {
  name            = ${formatValue(awsName)}
  cluster         = ${formatMaybeExpression(configString(config, 'cluster'))}
  task_definition = ${formatMaybeExpression(configString(config, 'task_definition'))}
  desired_count   = ${formatNumber(config.desired_count)}
  launch_type     = ${formatValue(configString(config, 'launch_type'))}
}
${ecsBindingComment(node, allNodes)}`,
      ];
    case 'vpc':
      return [
        `resource "aws_vpc" "${name}" {
  cidr_block           = ${formatValue(configString(config, 'cidr_block'))}
  enable_dns_hostnames = ${formatBoolean(config.enable_dns_hostnames)}
  enable_dns_support   = ${formatBoolean(config.enable_dns_support)}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    case 'subnet':
      return [
        `resource "aws_subnet" "${name}" {
  vpc_id                  = ${formatMaybeExpression(configString(config, 'vpc_id'))}
  cidr_block              = ${formatValue(configString(config, 'cidr_block'))}
  availability_zone       = ${formatValue(configString(config, 'availability_zone'))}
  map_public_ip_on_launch = ${formatBoolean(config.map_public_ip_on_launch)}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    case 'igw':
      return [
        `resource "aws_internet_gateway" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id'))}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    case 'route-table':
      return [
        `resource "aws_route_table" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id'))}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    case 'route':
      return [
        `resource "aws_route" "${name}" {
  route_table_id         = ${formatMaybeExpression(configString(config, 'route_table_id'))}
  destination_cidr_block = ${formatValue(configString(config, 'destination_cidr_block') || '0.0.0.0/0')}
  gateway_id             = ${formatMaybeExpression(configString(config, 'gateway_id'))}
}`,
      ];
    case 'route-association':
      return [
        `resource "aws_route_table_association" "${name}" {
  subnet_id      = ${formatMaybeExpression(configString(config, 'subnet_id'))}
  route_table_id = ${formatMaybeExpression(configString(config, 'route_table_id'))}
}`,
      ];
    case 'route53': {
      const cloudfrontNode = connectedServiceNode(node, allNodes, edges, 'cloudfront');
      const cloudfrontName = cloudfrontNode ? sanitizeName(cloudfrontNode.data.label || cloudfrontNode.data.serviceName) : '';
      const recordType = configString(config, 'type') || 'A';
      const common = `resource "aws_route53_record" "${name}" {
  zone_id = ${formatMaybeExpression(configString(config, 'zone_id'))}
  name    = ${formatValue(configString(config, 'name') || awsName)}
  type    = ${formatValue(recordType)}`;

      if (cloudfrontName && ['A', 'AAAA'].includes(recordType)) {
        return [
          `${common}

  alias {
    name                   = aws_cloudfront_distribution.${cloudfrontName}.domain_name
    zone_id                = aws_cloudfront_distribution.${cloudfrontName}.hosted_zone_id
    evaluate_target_health = false
  }
}`,
        ];
      }

      return [
        `${common}
  ttl     = ${formatNumber(config.ttl || 300)}
  records = ${formatListExpression(configString(config, 'records'))}
}`,
      ];
    }
    case 'security-group':
      return [
        `resource "aws_security_group" "${name}" {
  name        = ${formatValue(awsName)}
  description = ${formatValue(configString(config, 'description') || 'Managed by infraflow')}
  vpc_id      = ${formatMaybeExpression(configString(config, 'vpc_id'))}
${securityGroupIngressBlocks(configString(config, 'ingress_ports'), configString(config, 'ingress_cidr_blocks'))}${securityGroupEgressBlock(configString(config, 'egress_cidr_blocks'))}
  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    case 's3': {
      const bucketLine = configString(config, 'bucket')
        ? `  bucket = ${formatValue(configString(config, 'bucket'))}`
        : `  bucket_prefix = ${formatValue(configString(config, 'bucket_prefix') || `${uniqueBucketName(label).slice(0, 37)}-`)}`;
      const versioningStatus = configString(config, 'versioning');
      const websiteIndex = configString(config, 'website_index_document');
      const websiteError = configString(config, 'website_error_document') || websiteIndex;
      const publicRead = configString(config, 'public_read') === 'true' || Boolean(websiteIndex);
      const blocks = [
        `resource "aws_s3_bucket" "${name}" {
${bucketLine}
  force_destroy = true
}`,
      ];

      if (['Enabled', 'Suspended'].includes(versioningStatus)) {
        blocks.push(`resource "aws_s3_bucket_versioning" "${name}_versioning" {
  bucket = aws_s3_bucket.${name}.id
  versioning_configuration {
    status = ${formatValue(versioningStatus)}
  }
}`);
      }

      if (websiteIndex) {
        blocks.push(`resource "aws_s3_bucket_website_configuration" "${name}_website" {
  bucket = aws_s3_bucket.${name}.id

  index_document {
    suffix = ${formatValue(websiteIndex)}
  }

  error_document {
    key = ${formatValue(websiteError)}
  }
}`);
      }

      if (publicRead) {
        blocks.push(`resource "aws_s3_bucket_public_access_block" "${name}_public_access" {
  bucket = aws_s3_bucket.${name}.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}`);
        blocks.push(`resource "aws_s3_bucket_policy" "${name}_public_read" {
  bucket = aws_s3_bucket.${name}.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${'${'}aws_s3_bucket.${name}.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.${name}_public_access]
}`);
      }

      const kmsNode = connectedServiceNode(node, allNodes, edges, 'kms');
      const kmsName = kmsNode ? sanitizeName(kmsNode.data.label || kmsNode.data.serviceName) : '';
      // SSE-KMS requires an authenticated SigV4 request to decrypt on read. S3 static website
      // hosting (and any anonymous public-read bucket) only ever serves unsigned requests, so
      // combining the two always fails with "Requests specifying Server Side Encryption with AWS
      // KMS managed keys require AWS Signature Version 4." Public content also gains nothing from
      // KMS confidentiality-wise, so skip it here rather than break the site.
      if (kmsName && !websiteIndex && !publicRead) {
        blocks.push(`resource "aws_s3_bucket_server_side_encryption_configuration" "${name}_encryption" {
  bucket = aws_s3_bucket.${name}.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.${kmsName}.arn
    }
  }
}`);
      }

      return blocks;
    }
    case 'dynamodb':
      return [
        `resource "aws_dynamodb_table" "${name}" {
  name         = ${formatValue(awsName)}
  billing_mode = ${formatValue(configString(config, 'billing_mode'))}
  hash_key     = ${formatValue(configString(config, 'hash_key'))}
${optionalLine('read_capacity', config.read_capacity)}${optionalLine('write_capacity', config.write_capacity)}

  attribute {
    name = ${formatValue(configString(config, 'hash_key'))}
    type = ${formatValue(configString(config, 'hash_key_type'))}
  }
}`,
      ];
    case 'sqs':
      return [
        `resource "aws_sqs_queue" "${name}" {
  name                      = ${formatValue(awsName)}
  fifo_queue                = ${formatBoolean(config.fifo_queue)}
${optionalLine('visibility_timeout_seconds', config.visibility_timeout_seconds)}${optionalLine('message_retention_seconds', config.message_retention_seconds)}
}`,
      ];
    case 'sns':
      return [
        `resource "aws_sns_topic" "${name}" {
  name         = ${formatValue(awsName)}
${optionalLine('display_name', config.display_name)}
}`,
      ];
    case 'secrets':
      return [
        `resource "aws_secretsmanager_secret" "${name}" {
  name = ${formatValue(awsName)}
${optionalLine('description', config.description)}${optionalLine('recovery_window_in_days', config.recovery_window_in_days)}
}`,
      ];
    case 'eventbridge':
      return [
        `resource "aws_cloudwatch_event_rule" "${name}" {
  name = ${formatValue(awsName)}
${optionalExpressionLine('event_pattern', config.event_pattern)}${optionalLine('schedule_expression', config.schedule_expression)}
}`,
      ];
    case 'cloudwatch':
      const cloudWatchProviderLine = configString(config, 'namespace') === 'AWS/CloudFront' ? '  provider            = aws.us_east_1\n' : '';
      return [
        `resource "aws_cloudwatch_metric_alarm" "${name}" {
${cloudWatchProviderLine}  alarm_name          = ${formatValue(configString(config, 'alarm_name') || awsName)}
  comparison_operator = ${formatValue(configString(config, 'comparison_operator'))}
  evaluation_periods  = ${formatNumber(config.evaluation_periods)}
  metric_name         = ${formatValue(configString(config, 'metric_name'))}
  namespace           = ${formatValue(configString(config, 'namespace'))}
  period              = ${formatNumber(config.period)}
  statistic           = ${formatValue(configString(config, 'statistic'))}
  threshold           = ${formatNumber(config.threshold)}
}`,
      ];
    case 'cloudfront': {
      const originNode = connectedServiceNode(node, allNodes, edges, 's3') ?? allNodes.find((candidate) => candidate.data.serviceId === 's3');
      const originName = originNode ? sanitizeName(originNode.data.label || originNode.data.serviceName) : '';
      const originId = originName ? `s3-${originName}` : `${name}-origin`;
      const originDomain = originName ? `aws_s3_bucket.${originName}.bucket_regional_domain_name` : formatValue(configString(config, 'origin_domain_name') || 'replace-with-origin.example.com');
      const wafNode = connectedServiceNode(node, allNodes, edges, 'waf');
      const wafName = wafNode ? sanitizeName(wafNode.data.label || wafNode.data.serviceName) : '';
      const wafLine = wafName ? `  web_acl_id          = aws_wafv2_web_acl.${wafName}.arn\n` : '';

      return [
        `resource "aws_cloudfront_distribution" "${name}" {
  enabled             = ${formatBoolean(config.enabled)}
  comment             = ${formatValue(configString(config, 'comment') || awsName)}
  default_root_object = ${formatValue(configString(config, 'default_root_object') || 'index.html')}
  price_class         = ${formatValue(configString(config, 'price_class') || 'PriceClass_100')}
${wafLine}
  origin {
    domain_name = ${originDomain}
    origin_id   = ${formatValue(originId)}
  }

  default_cache_behavior {
    target_origin_id       = ${formatValue(originId)}
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}`,
      ];
    }
    case 'apigw': {
      const lambdaNode = connectedServiceNode(node, allNodes, edges, 'lambda');
      const blocks = [
        `resource "aws_apigatewayv2_api" "${name}" {
  name          = ${formatValue(awsName)}
  protocol_type = ${formatValue(configString(config, 'protocol_type') || 'HTTP')}
}`,
      ];

      if (lambdaNode) {
        const lambdaName = sanitizeName(lambdaNode.data.label || lambdaNode.data.serviceName);
        blocks.push(`resource "aws_apigatewayv2_integration" "${name}_lambda" {
  api_id                 = aws_apigatewayv2_api.${name}.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.${lambdaName}.invoke_arn
  payload_format_version = "2.0"
}`);
        blocks.push(`resource "aws_apigatewayv2_route" "${name}_default" {
  api_id    = aws_apigatewayv2_api.${name}.id
  route_key = ${formatValue(configString(config, 'route_key') || 'ANY /{proxy+}')}
  target    = "integrations/\${aws_apigatewayv2_integration.${name}_lambda.id}"
}`);
        blocks.push(`resource "aws_apigatewayv2_stage" "${name}_default" {
  api_id      = aws_apigatewayv2_api.${name}.id
  name        = "$default"
  auto_deploy = true
}`);
        blocks.push(`resource "aws_lambda_permission" "${name}_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${lambdaName}.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_apigatewayv2_api.${name}.execution_arn}/*/*"
}`);
      }

      return blocks;
    }
    case 'iam': {
      const forLambda = Boolean(connectedServiceNode(node, allNodes, edges, 'lambda'));
      const trustPolicy = configString(config, 'assume_role_policy') || (forLambda
        ? `jsonencode({"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]})`
        : '');
      const blocks = [
        `resource "aws_iam_role" "${name}" {
  name               = ${formatValue(awsName)}
  assume_role_policy = ${formatJsonOrExpression(trustPolicy)}
}`,
      ];
      if (forLambda) {
        blocks.push(`resource "aws_iam_role_policy_attachment" "${name}_lambda_basic_execution" {
  role       = aws_iam_role.${name}.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}`);
      }
      return blocks;
    }
    case 'waf': {
      const defaultAction = configString(config, 'default_action') === 'block' ? 'block' : 'allow';
      const metricName = configString(config, 'metric_name') || sanitizeMetricName(awsName);
      const providerLine = configString(config, 'scope') === 'CLOUDFRONT' ? '  provider = aws.us_east_1\n' : '';
      return [
        `resource "aws_wafv2_web_acl" "${name}" {
${providerLine}  name  = ${formatValue(awsName)}
  scope = ${formatValue(configString(config, 'scope') || 'CLOUDFRONT')}

  default_action {
    ${defaultAction} {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = ${formatValue(metricName)}
    sampled_requests_enabled   = true
  }
}`,
      ];
    }
    default: {
      const fallbackFullConfig = { ...config };
      const identifierField = identifierFieldByServiceId[node.data.serviceId ?? ''];
      if (identifierField && isEmptyValue(fallbackFullConfig[identifierField])) {
        fallbackFullConfig[identifierField] = uniqueAwsName(label);
      }

      const fallbackConfig = Object.entries(fallbackFullConfig)
        .filter(([, value]) => !isEmptyValue(value))
        .filter(([key]) => !['region', 'status'].includes(key))
        .map(([key, value]) => `  ${key} = ${formatMaybeExpression(value)}`)
        .join('\n');

      return [`resource "${service?.terraformType ?? 'aws_resource'}" "${name}" {\n${fallbackConfig || '  # Add required arguments'}\n}`];
    }
  }
}

// Config key that AWS requires to be unique (per region/account, or globally for a few types) for
// resource types handled by the default fallback above. When that field is left blank, the fallback
// fills it with an auto-generated per-diagram name instead of omitting the argument entirely.
const identifierFieldByServiceId: Record<string, string> = {
  alb: 'name',
  'lb-target-group': 'name',
  ecs: 'name',
  ecr: 'name',
  eks: 'name',
  elasticache: 'cluster_id',
  redshift: 'cluster_identifier',
  rds: 'identifier',
  docdb: 'cluster_identifier',
  'docdb-instance': 'identifier',
  'docdb-subnet-group': 'name',
  kinesis: 'name',
  cognito: 'name',
  codebuild: 'name',
  codepipeline: 'name',
  beanstalk: 'name',
};

function connectedServiceNode(node: AwsNode, allNodes: AwsNode[], edges: AwsEdge[], serviceId: string): AwsNode | undefined {
  const nodeById = Object.fromEntries(allNodes.map((candidate) => [candidate.id, candidate]));
  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = nodeById[otherId];
    if (otherNode?.data.serviceId === serviceId) return otherNode;
  }
  return undefined;
}

function resourceOutputBlock(nodes: AwsNode[]): string {
  const hasManagedEc2Keys = nodes.some(shouldCreateManagedEc2KeyPair);
  const entries = nodes
    .filter((node) => node.data.serviceId && serviceById[node.data.serviceId])
    .map((node) => {
      const service = serviceById[node.data.serviceId!];
      const resourceName = sanitizeName(node.data.label || node.data.serviceName);
      const outputs = expectedOutputsForNode(node);
      const attrs = outputs.map((attr) => outputAttributeExpression(node, service.terraformType, resourceName, attr)).join('\n');

      return `    ${resourceName} = {
      label = ${formatValue(node.data.label || node.data.serviceName)}
      service = ${formatValue(node.data.serviceName)}
      terraform_address = ${formatValue(`${service.terraformType}.${resourceName}`)}
${attrs}
    }`;
    });

  if (!entries.length) return '';

  return `output "infraflow_resource_outputs" {
  description = "Resource identifiers, ARNs, endpoints, and connectivity values generated by infraflow."
  value = {
${entries.join('\n')}
  }${hasManagedEc2Keys ? '\n  sensitive = true' : ''}
}`;
}

function outputAttributeExpression(node: AwsNode, terraformType: string, resourceName: string, attr: string): string {
  if (node.data.serviceId === 'ec2' && attr === 'key_pair_name') {
    return shouldCreateManagedEc2KeyPair(node)
      ? `      ${attr} = try(aws_key_pair.${managedEc2KeyPairResourceName(resourceName)}.key_name, null)`
      : `      ${attr} = try(${terraformType}.${resourceName}.key_name, null)`;
  }

  if (node.data.serviceId === 'ec2' && attr === 'ssh_private_key_pem') {
    return shouldCreateManagedEc2KeyPair(node)
      ? `      ${attr} = try(tls_private_key.${managedEc2KeyPairResourceName(resourceName)}.private_key_pem, null)`
      : `      ${attr} = null`;
  }

  if (node.data.serviceId === 's3' && ['website_endpoint', 'website_domain'].includes(attr)) {
    return `      ${attr} = try(aws_s3_bucket_website_configuration.${resourceName}_website.${attr}, null)`;
  }

  return `      ${attr} = try(${terraformType}.${resourceName}.${attr}, null)`;
}

function expectedOutputsForNode(node: AwsNode): string[] {
  const outputs = expectedOutputsForService(node.data.serviceId);
  if (node.data.serviceId === 's3' && configString(node.data.config ?? {}, 'website_index_document')) {
    return [...outputs, 'website_endpoint', 'website_domain'];
  }
  return outputs;
}

function bindingSupportBlocks(nodes: AwsNode[], allNodes: AwsNode[]): string[] {
  const bindings = nodes.flatMap((node) => node.data.bindings ?? []);
  const blocks: string[] = [];

  for (const binding of bindings) {
    const resourceName = sanitizeName(binding.source.id);
    if (binding.source.kind === 'variable') {
      blocks.push(`variable "${resourceName}" {
  type      = string
  sensitive = ${binding.sensitive ? 'true' : 'false'}
}`);
    }

    if (binding.source.kind === 'local') {
      blocks.push(`locals {
  ${resourceName} = "" # Set ${binding.source.id} outside the visual builder
}`);
    }

    if (binding.source.kind === 'ssm') {
      blocks.push(`data "aws_ssm_parameter" "${resourceName}" {
  name            = ${formatValue(binding.source.id)}
  with_decryption = ${binding.sensitive ? 'true' : 'false'}
}`);
    }

    if (binding.source.kind === 'secret' && !allNodes.some((node) => node.id === binding.source.id)) {
      blocks.push(`data "aws_secretsmanager_secret" "${resourceName}" {
  name = ${formatValue(binding.source.id)}
}`);
    }
  }

  return blocks;
}

function lambdaEnvironmentBlock(node: AwsNode, allNodes: AwsNode[]): string {
  const envBindings = (node.data.bindings ?? []).filter((binding) => binding.targetKind === 'env');
  if (!envBindings.length) return '';

  const entries = envBindings
    .map((binding) => `    ${sanitizeEnvName(binding.targetPath)} = ${bindingExpression(binding, allNodes)}`)
    .join('\n');

  return `

  environment {
    variables = {
${entries}
    }
  }`;
}

function ecsBindingComment(node: AwsNode, allNodes: AwsNode[]): string {
  const bindings = node.data.bindings ?? [];
  if (!bindings.length) return '';

  const lines = bindings.map((binding) => {
    const target = binding.targetKind === 'env' ? `container secret/env ${binding.targetPath}` : `${binding.targetKind} ${binding.targetPath}`;
    return `# - ${target} <= ${bindingExpression(binding, allNodes)}`;
  });

return `# Bind these references in the ECS task definition container_definitions:
${lines.join('\n')}`;
}

function securityGroupIngressBlocks(portsValue: string, cidrsValue: string): string {
  const ports = splitList(portsValue).map(Number).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  const cidrs = splitList(cidrsValue);
  if (!ports.length || !cidrs.length) return '';

  return ports
    .map(
      (port) => `
  ingress {
    description = "Allow TCP ${port}"
    from_port   = ${port}
    to_port     = ${port}
    protocol    = "tcp"
    cidr_blocks = ${formatStringList(cidrs)}
  }
`,
    )
    .join('');
}

function securityGroupEgressBlock(cidrsValue: string): string {
  const cidrs = splitList(cidrsValue);
  if (!cidrs.length) return '';

  return `
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ${formatStringList(cidrs)}
  }
`;
}

function bindingExpression(binding: NodeBinding, allNodes: AwsNode[]): string {
  if (binding.source.kind === 'variable') return binding.source.id.startsWith('var.') ? binding.source.id : `var.${sanitizeName(binding.source.id)}`;
  if (binding.source.kind === 'local') return binding.source.id.startsWith('local.') ? binding.source.id : `local.${sanitizeName(binding.source.id)}`;
  if (binding.source.kind === 'ssm') return `data.aws_ssm_parameter.${sanitizeName(binding.source.id)}.${binding.source.attribute || 'value'}`;
  if (binding.source.kind === 'resourceAttr' || binding.source.kind === 'output') return binding.source.attribute ? `${binding.source.id}.${binding.source.attribute}` : binding.source.id;

  const sourceNode = allNodes.find((candidate) => candidate.id === binding.source.id);
  if (sourceNode?.data.serviceId === 'secrets') return `aws_secretsmanager_secret.${sanitizeName(sourceNode.data.label)}.${binding.source.attribute || 'arn'}`;
  return `data.aws_secretsmanager_secret.${sanitizeName(binding.source.id)}.${binding.source.attribute || 'arn'}`;
}

function sanitizeEnvName(value: string): string {
  return value
    .split('.')
    .pop()!
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^([0-9])/, '_$1')
    .toUpperCase();
}

function formatValue(value: string | number | boolean): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === 'true' || value === 'false') return value;
  return `"${escapeString(value)}"`;
}

function formatMaybeExpression(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return formatValue(value);
  const trimmed = String(value ?? '').trim();
  if (looksLikeTerraformExpression(trimmed)) return trimmed.replace(/^\${(.+)}$/, '$1');
  return formatValue(trimmed);
}

// Like formatMaybeExpression, but for fields (like assume_role_policy) that Terraform expects to
// be a *string* containing JSON. Raw pasted JSON ("{...}"/"[...]") is wrapped in jsonencode(...) so
// it evaluates to a string, instead of being emitted as a bare HCL object (wrong type). Genuine
// Terraform expressions (data.x.json, var.x, an already-wrapped jsonencode(...)) pass through as-is.
function formatJsonOrExpression(value: string | number | boolean): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return formatValue('');
  if (/^[{[]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return `jsonencode(${trimmed})`;
    } catch {
      return formatValue(trimmed);
    }
  }
  return formatMaybeExpression(trimmed);
}

function formatNumber(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value).trim() !== '' ? String(parsed) : 'null';
}

function formatBoolean(value: unknown): string {
  if (String(value) === 'true') return 'true';
  if (String(value) === 'false') return 'false';
  return 'null';
}

function optionalLine(key: string, value: unknown): string {
  if (isEmptyValue(value)) return '';
  return `  ${key} = ${formatMaybeExpression(value as string | number | boolean)}\n`;
}

function optionalExpressionLine(key: string, value: unknown): string {
  if (isEmptyValue(value)) return '';
  return `  ${key} = ${formatMaybeExpression(value as string | number | boolean)}\n`;
}

function configString(config: Record<string, string | number>, key: string): string {
  return String(config[key] ?? '').trim();
}

function ec2AmiExpression(config: Record<string, string | number>): string {
  return configString(config, 'ami') || latestAmazonLinux2023Ami;
}

function shouldCreateManagedEc2KeyPair(node: AwsNode): boolean {
  return node.data.serviceId === 'ec2' && !configString(node.data.config ?? {}, 'key_name');
}

function managedEc2KeyPairResourceName(resourceName: string): string {
  return `ec2_key_${resourceName}`.slice(0, 48);
}

function ec2SecurityGroupIdsLine(node: AwsNode, allNodes: AwsNode[], edges: AwsEdge[]): string {
  const declaredSecurityGroupNames = new Set(
    allNodes
      .filter((candidate) => candidate.data.serviceId === 'security-group')
      .map((candidate) => sanitizeName(candidate.data.label)),
  );
  const expression = mergeListExpression(
    configString(node.data.config, 'vpc_security_group_ids'),
    securityGroupRefsForEc2(node, allNodes, edges),
    declaredSecurityGroupNames,
  );
  return expression ? `  vpc_security_group_ids = ${expression}\n` : '';
}

function securityGroupRefsForEc2(node: AwsNode, allNodes: AwsNode[], edges: AwsEdge[]): string[] {
  const nodeById = Object.fromEntries(allNodes.map((candidate) => [candidate.id, candidate]));
  const refs = edges.flatMap((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return [];

    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = nodeById[otherId];
    if (otherNode?.data.serviceId !== 'security-group') return [];

    return `aws_security_group.${sanitizeName(otherNode.data.label)}.id`;
  });

  return Array.from(new Set(refs));
}

function mergeListExpression(configValue: string, inferredRefs: string[], declaredSecurityGroupNames = new Set<string>()): string {
  const explicit = sanitizeConfiguredListExpression(configValue.trim(), declaredSecurityGroupNames);
  const missingRefs = inferredRefs.filter((ref) => !explicit.includes(ref));

  if (!explicit && !missingRefs.length) return '';
  if (!explicit) return `[${missingRefs.join(', ')}]`;

  const explicitExpression = formatListExpression(explicit);
  if (!missingRefs.length) return explicitExpression;

  return `distinct(concat(${explicitExpression}, [${missingRefs.join(', ')}]))`;
}

function sanitizeConfiguredListExpression(value: string, declaredSecurityGroupNames: Set<string>): string {
  if (!value) return '';

  const entries = parseSimpleListExpression(value);
  if (!entries) return value;

  const filteredEntries = entries.filter((entry) => {
    const match = entry.match(/^aws_security_group\.([A-Za-z0-9_]+)\.id$/);
    return !match || declaredSecurityGroupNames.has(match[1]);
  });

  if (!filteredEntries.length) return '';
  if (filteredEntries.length === entries.length) return value;
  return `[${filteredEntries.map(formatListEntry).join(', ')}]`;
}

function parseSimpleListExpression(value: string): string[] | undefined {
  const text = value.trim();
  if (!text) return [];
  if (/^(distinct|concat|flatten|toset|tolist)\s*\(/.test(text)) return undefined;

  const listMatch = text.match(/^\[(.*)\]$/s);
  const body = listMatch ? listMatch[1] : text;
  return body.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function formatListEntry(entry: string): string {
  if (/^".*"$/.test(entry) || /^'.*'$/.test(entry) || looksLikeTerraformExpression(entry)) return entry;
  return formatValue(entry);
}

function formatListExpression(value: string | number | boolean): string {
  const text = String(value).trim();
  if (looksLikeTerraformExpression(text)) return text.replace(/^\${(.+)}$/, '$1');
  return formatStringList(splitList(text));
}

function formatStringList(values: string[]): string {
  return `[${values.map((value) => formatValue(value)).join(', ')}]`;
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function looksLikeTerraformExpression(value: string): boolean {
  return /^\${.+}$/.test(value) || /^(data\.|aws_|var\.|local\.|module\.|filebase64sha256\(|jsonencode\(|\[|\{)/.test(value);
}

function firstRegion(nodes: AwsNode[]): string | undefined {
  return nodes.find((node) => node.data.region || node.data.config.region)?.data.region;
}

function uniqueAwsName(label: string): string {
  return sanitizeName(`infraflow-${label}`).replace(/_/g, '-').slice(0, 64);
}

function uniqueBucketName(label: string): string {
  return uniqueAwsName(label).toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 63);
}

function roleArnFromNode(node: AwsNode): string {
  const configArn = String(node.data.config?.iam_role_arn ?? '').trim();
  const nodeArn = String(node.data.arn ?? '').trim();
  if (configArn) return configArn;
  return nodeArn.includes(':role/') ? nodeArn : '';
}

function roleNameFromArn(arn: string): string {
  return arn.split(':role/')[1]?.split('/').pop() ?? arn;
}

function sharedEc2ProfileResourceName(roleName: string): string {
  return `ec2_profile_${sanitizeName(roleName)}`.slice(0, 48);
}

function dedupeTerraformBlocks(blocks: string[]): string[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = terraformBlockKey(block);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function terraformBlockKey(block: string): string {
  const firstLine = block
    .split('\n')
    .find((line) => line.trim() && !line.trim().startsWith('#'))
    ?.trim();
  if (!firstLine) return '';

  const typed = firstLine.match(/^(resource|data)\s+"([^"]+)"\s+"([^"]+)"/);
  if (typed) return `${typed[1]}.${typed[2]}.${typed[3]}`;

  const singleton = firstLine.match(/^(terraform|provider\s+"[^"]+")\s*\{/);
  return singleton?.[1] ?? '';
}

function escapeString(value: string | number | boolean): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nodeName(nodes: AwsNode[], id: string): string {
  return nodes.find((node) => node.id === id)?.data.label ?? id;
}
