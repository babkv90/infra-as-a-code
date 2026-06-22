const terraformTypeByServiceId = {
  alb: 'aws_lb',
  apigw: 'aws_apigatewayv2_api',
  beanstalk: 'aws_elastic_beanstalk_environment',
  cloudfront: 'aws_cloudfront_distribution',
  cloudwatch: 'aws_cloudwatch_metric_alarm',
  codebuild: 'aws_codebuild_project',
  codepipeline: 'aws_codepipeline',
  cognito: 'aws_cognito_user_pool',
  dynamodb: 'aws_dynamodb_table',
  ebs: 'aws_ebs_volume',
  ec2: 'aws_instance',
  ecr: 'aws_ecr_repository',
  ecs: 'aws_ecs_service',
  efs: 'aws_efs_file_system',
  eks: 'aws_eks_cluster',
  elasticache: 'aws_elasticache_cluster',
  eventbridge: 'aws_cloudwatch_event_rule',
  iam: 'aws_iam_role',
  kinesis: 'aws_kinesis_stream',
  kms: 'aws_kms_key',
  lambda: 'aws_lambda_function',
  nat: 'aws_nat_gateway',
  rds: 'aws_db_instance',
  redshift: 'aws_redshift_cluster',
  route: 'aws_route',
  'route-association': 'aws_route_table_association',
  'route-table': 'aws_route_table',
  route53: 'aws_route53_record',
  s3: 'aws_s3_bucket',
  secrets: 'aws_secretsmanager_secret',
  'security-group': 'aws_security_group',
  sns: 'aws_sns_topic',
  sqs: 'aws_sqs_queue',
  subnet: 'aws_subnet',
  vpc: 'aws_vpc',
  igw: 'aws_internet_gateway',
  waf: 'aws_wafv2_web_acl',
  xray: 'aws_xray_group',
};

const deployableServices = new Set(Object.keys(terraformTypeByServiceId));

export function generateTerraform(nodes = [], edges = [], options = {}) {
  const region = options.region ?? firstRegion(nodes) ?? 'ap-south-1';
  const suffix = sanitizeName(options.suffix ?? 'diagram').slice(0, 16) || 'diagram';
  const serviceNodes = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId);
  const deployableNodes = serviceNodes.filter((node) => deployableServices.has(node.data.serviceId));
  const unsupportedNodes = serviceNodes.filter((node) => !deployableServices.has(node.data.serviceId));
  const names = Object.fromEntries(deployableNodes.map((node) => [node.id, resourceName(node, suffix)]));
  const blocks = dedupeTerraformBlocks([
    terraformHeader(region),
    ...awsDataSourceBlocks(deployableNodes),
    ...ec2AmiDataBlocks(deployableNodes),
    ...ec2InstanceProfileBlocks(deployableNodes, suffix),
    ...deployableNodes.flatMap((node) => resourceBlocksForNode(node, names[node.id], suffix)),
    ...connectionBlocks(deployableNodes, edges, names),
  ]);

  if (unsupportedNodes.length) {
    blocks.push(
      [
        '# Unsupported visual nodes skipped by realtime deployment:',
        ...unsupportedNodes.map((node) => `# - ${node.data?.serviceName ?? node.data?.serviceId ?? node.id}`),
      ].join('\n'),
    );
  }

  return blocks.filter(Boolean).join('\n\n');
}

function terraformHeader(region) {
  return `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${escapeString(region)}"
  default_tags {
    tags = {
      ManagedBy = "InfraPilotAI"
    }
  }
}`;
}

function ec2InstanceProfileBlocks(nodes, suffix) {
  const roleEntries = new Map();

  for (const node of nodes) {
    if (node.data.serviceId !== 'ec2') continue;
    const config = node.data?.config ?? {};
    if (config.iam_instance_profile) continue;

    const roleArn = roleArnFromNode(node);
    const roleName = roleNameFromArn(roleArn);
    if (!roleArn || !roleName) continue;

    if (!roleEntries.has(roleName)) roleEntries.set(roleName, { roleArn, roleName });
  }

  return Array.from(roleEntries.values()).flatMap(({ roleArn, roleName }) => {
    const resourceName = sharedEc2ProfileResourceName(roleName);
    const profileName = `${uniqueAwsName(roleName, suffix)}-profile`.slice(0, 128);

    return [
      `# IAM role ARN: ${escapeString(roleArn)}
data "aws_iam_role" "${resourceName}_role" {
  name = "${escapeString(roleName)}"
}`,
      `resource "aws_iam_instance_profile" "${resourceName}" {
  name = "${escapeString(profileName)}"
  role = data.aws_iam_role.${resourceName}_role.name
}`,
    ];
  });
}

function ec2AmiDataBlocks(nodes) {
  if (!nodes.some((node) => node.data?.serviceId === 'ec2' && configString(node.data?.config, 'ami') === 'data.aws_ami.amazon_linux_2023.id')) return [];

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

function awsDataSourceBlocks(nodes) {
  const configValues = nodes.flatMap((node) => Object.values(node.data?.config ?? {}).map(String));
  const blocks = [];

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

function resourceBlocksForNode(node, name, suffix) {
  const config = node.data?.config ?? {};
  const label = node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId;
  const uniqueName = configString(config, 'name') || uniqueAwsName(label, suffix);

  switch (node.data.serviceId) {
    case 'apigw':
      return [
        `resource "aws_apigatewayv2_api" "${name}" {
  name          = ${formatValue(uniqueName)}
  protocol_type = ${formatValue(configString(config, 'protocol_type'))}
}`,
      ];
    case 'cloudwatch':
      return [
        `resource "aws_cloudwatch_metric_alarm" "${name}" {
  alarm_name          = ${formatValue(configString(config, 'alarm_name') || uniqueName)}
  comparison_operator = ${formatValue(configString(config, 'comparison_operator'))}
  evaluation_periods  = ${formatNumber(config.evaluation_periods)}
  metric_name         = ${formatValue(configString(config, 'metric_name'))}
  namespace           = ${formatValue(configString(config, 'namespace'))}
  period              = ${formatNumber(config.period)}
  statistic           = ${formatValue(configString(config, 'statistic'))}
  threshold           = ${formatNumber(config.threshold)}
}`,
      ];
    case 'dynamodb':
      return [
        `resource "aws_dynamodb_table" "${name}" {
  name         = ${formatValue(uniqueName)}
  billing_mode = ${formatValue(configString(config, 'billing_mode'))}
  hash_key     = ${formatValue(configString(config, 'hash_key'))}
${optionalLine('read_capacity', config.read_capacity)}${optionalLine('write_capacity', config.write_capacity)}

  attribute {
    name = ${formatValue(configString(config, 'hash_key'))}
    type = ${formatValue(configString(config, 'hash_key_type'))}
  }
}`,
      ];
    case 'ec2':
      const instanceProfile = ec2InstanceProfileReference(node);
      return [
        `resource "aws_instance" "${name}" {
  ami           = ${formatMaybeExpression(configString(config, 'ami'))}
  instance_type = ${formatValue(configString(config, 'instance_type'))}
${optionalExpressionLine('subnet_id', config.subnet_id)}${optionalListExpressionLine('vpc_security_group_ids', config.vpc_security_group_ids)}${optionalLine('associate_public_ip_address', config.associate_public_ip_address)}${instanceProfile ? `  iam_instance_profile = ${instanceProfile}\n` : ''}

  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 'eventbridge':
      return [
        `resource "aws_cloudwatch_event_rule" "${name}" {
  name = ${formatValue(uniqueName)}
${optionalExpressionLine('event_pattern', config.event_pattern)}${optionalLine('schedule_expression', config.schedule_expression)}
}`,
      ];
    case 'iam':
      return [
        `resource "aws_iam_role" "${name}" {
  name               = ${formatValue(uniqueName)}
  assume_role_policy = ${formatMaybeExpression(configString(config, 'assume_role_policy'))}
}`,
      ];
    case 'lambda':
      return [
        `resource "aws_lambda_function" "${name}" {
  function_name    = ${formatValue(configString(config, 'function_name') || uniqueName)}
  role             = ${formatValue(configString(config, 'role_arn'))}
  filename         = ${formatValue(configString(config, 'filename'))}
  source_code_hash = ${formatMaybeExpression(configString(config, 'source_code_hash'))}
  handler          = ${formatValue(configString(config, 'handler'))}
  runtime          = ${formatValue(configString(config, 'runtime'))}
  memory_size      = ${formatNumber(config.memory_size)}
  timeout          = ${formatNumber(config.timeout)}
}`,
      ];
    case 'igw':
      return [
        `resource "aws_internet_gateway" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id'))}

  tags = {
    Name = ${formatValue(uniqueName || label)}
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
    case 'route-table':
      return [
        `resource "aws_route_table" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id'))}

  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 's3':
      return [
        `resource "aws_s3_bucket" "${name}" {
  bucket = ${formatValue(configString(config, 'bucket'))}
}`,
        `resource "aws_s3_bucket_versioning" "${name}_versioning" {
  bucket = aws_s3_bucket.${name}.id
  versioning_configuration {
    status = ${formatValue(configString(config, 'versioning'))}
  }
}`,
      ];
    case 'secrets':
      return [
        `resource "aws_secretsmanager_secret" "${name}" {
  name = ${formatValue(uniqueName)}
${optionalLine('description', config.description)}${optionalLine('recovery_window_in_days', config.recovery_window_in_days)}
}`,
      ];
    case 'security-group':
      return [
        `resource "aws_security_group" "${name}" {
  name        = ${formatValue(uniqueName)}
  description = ${formatValue(configString(config, 'description') || 'Managed by InfraPilot AI')}
  vpc_id      = ${formatMaybeExpression(configString(config, 'vpc_id'))}
${securityGroupIngressBlocks(configString(config, 'ingress_ports'), configString(config, 'ingress_cidr_blocks'))}${securityGroupEgressBlock(configString(config, 'egress_cidr_blocks'))}
  tags = {
    Name = ${formatValue(uniqueName || label)}
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
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 'sns':
      return [
        `resource "aws_sns_topic" "${name}" {
  name = ${formatValue(uniqueName)}
${optionalLine('display_name', config.display_name)}
}`,
      ];
    case 'sqs':
      return [
        `resource "aws_sqs_queue" "${name}" {
  name                      = ${formatValue(uniqueName)}
  fifo_queue                = ${formatBoolean(config.fifo_queue)}
${optionalLine('visibility_timeout_seconds', config.visibility_timeout_seconds)}${optionalLine('message_retention_seconds', config.message_retention_seconds)}
}`,
      ];
    case 'vpc':
      return [
        `resource "aws_vpc" "${name}" {
  cidr_block           = ${formatValue(configString(config, 'cidr_block'))}
  enable_dns_hostnames = ${formatBoolean(config.enable_dns_hostnames)}
  enable_dns_support   = ${formatBoolean(config.enable_dns_support)}

  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    default:
      return genericResourceBlock(node, name);
  }
}

function genericResourceBlock(node, name) {
  const terraformType = terraformTypeByServiceId[node.data?.serviceId];
  const config = node.data?.config ?? {};
  if (!terraformType) return [];

  const body = Object.entries(config)
    .filter(([, value]) => !isEmptyValue(value))
    .filter(([key]) => !['region', 'status'].includes(key))
    .map(([key, value]) => `  ${key} = ${formatMaybeExpression(value)}`)
    .join('\n');

  return [`resource "${terraformType}" "${name}" {\n${body || '  # Fill this service form before deployment.'}\n}`];
}

function connectionBlocks(nodes, edges, names) {
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const blocks = [];

  for (const edge of edges) {
    const source = nodeById[edge.source];
    const target = nodeById[edge.target];
    if (!source || !target) continue;

    const sourceService = source.data.serviceId;
    const targetService = target.data.serviceId;
    const sourceName = names[source.id];
    const targetName = names[target.id];
    const edgeName = sanitizeName(edge.id);

    if (sourceService === 'apigw' && targetService === 'lambda') {
      blocks.push(`resource "aws_apigatewayv2_integration" "${edgeName}" {
  api_id                 = aws_apigatewayv2_api.${sourceName}.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.${targetName}.invoke_arn
  payload_format_version = "2.0"
}`);
      blocks.push(`resource "aws_apigatewayv2_route" "${edgeName}" {
  api_id    = aws_apigatewayv2_api.${sourceName}.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/\${aws_apigatewayv2_integration.${edgeName}.id}"
}`);
      blocks.push(`resource "aws_apigatewayv2_stage" "${edgeName}" {
  api_id      = aws_apigatewayv2_api.${sourceName}.id
  name        = "$default"
  auto_deploy = true
}`);
      blocks.push(`resource "aws_lambda_permission" "${edgeName}" {
  statement_id  = "AllowApiGatewayInvoke${edgeName}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${targetName}.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_apigatewayv2_api.${sourceName}.execution_arn}/*/*"
}`);
    }

    if (sourceService === 'eventbridge' && targetService === 'lambda') {
      blocks.push(`resource "aws_cloudwatch_event_target" "${edgeName}" {
  rule = aws_cloudwatch_event_rule.${sourceName}.name
  arn  = aws_lambda_function.${targetName}.arn
}`);
      blocks.push(`resource "aws_lambda_permission" "${edgeName}" {
  statement_id  = "AllowEventBridgeInvoke${edgeName}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${targetName}.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.${sourceName}.arn
}`);
    }
  }

  return blocks;
}

function firstRegion(nodes) {
  return nodes.find((node) => node?.data?.region)?.data.region;
}

function resourceName(node, suffix) {
  return sanitizeName(node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId ?? suffix).slice(0, 48);
}

function uniqueAwsName(label, suffix) {
  return sanitizeName(`infrapilot-${label}-${suffix}`).replaceAll('_', '-').slice(0, 64);
}

function uniqueBucketName(label, suffix) {
  return uniqueAwsName(label, suffix).toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 63);
}

function roleArnFromNode(node) {
  const configArn = String(node.data?.config?.iam_role_arn ?? '').trim();
  const nodeArn = String(node.data?.arn ?? '').trim();
  if (configArn) return configArn;
  return nodeArn.includes(':role/') ? nodeArn : '';
}

function roleNameFromArn(arn) {
  return arn.split(':role/')[1]?.split('/').pop() ?? '';
}

function ec2InstanceProfileReference(node) {
  const config = node.data?.config ?? {};
  if (config.iam_instance_profile) return formatValue(config.iam_instance_profile);

  const roleName = roleNameFromArn(roleArnFromNode(node));
  if (!roleName) return undefined;
  return `aws_iam_instance_profile.${sharedEc2ProfileResourceName(roleName)}.name`;
}

function sharedEc2ProfileResourceName(roleName) {
  return `ec2_profile_${sanitizeName(roleName)}`.slice(0, 48);
}

function dedupeTerraformBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key = terraformBlockKey(block);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function terraformBlockKey(block) {
  const firstLine = String(block).split('\n').find((line) => line.trim() && !line.trim().startsWith('#'))?.trim();
  if (!firstLine) return '';

  const typed = firstLine.match(/^(resource|data)\s+"([^"]+)"\s+"([^"]+)"/);
  if (typed) return `${typed[1]}.${typed[2]}.${typed[3]}`;

  const singleton = firstLine.match(/^(terraform|provider\s+"[^"]+")\s*\{/);
  return singleton?.[1] ?? '';
}

function sanitizeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resource';
}

function escapeString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function formatValue(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === 'true' || value === 'false') return value;
  return `"${escapeString(value ?? '')}"`;
}

function formatMaybeExpression(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return formatValue(value);
  const trimmed = String(value ?? '').trim();
  if (looksLikeTerraformExpression(trimmed)) return trimmed.replace(/^\${(.+)}$/, '$1');
  return formatValue(trimmed);
}

function formatNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(value).trim() !== '' ? String(parsed) : 'null';
}

function formatBoolean(value) {
  if (String(value) === 'true') return 'true';
  if (String(value) === 'false') return 'false';
  return 'null';
}

function optionalLine(key, value) {
  if (isEmptyValue(value)) return '';
  return `  ${key} = ${formatMaybeExpression(value)}\n`;
}

function optionalExpressionLine(key, value) {
  if (isEmptyValue(value)) return '';
  return `  ${key} = ${formatMaybeExpression(value)}\n`;
}

function optionalListExpressionLine(key, value) {
  if (isEmptyValue(value)) return '';
  return `  ${key} = ${formatListExpression(value)}\n`;
}

function configString(config, key) {
  return String(config?.[key] ?? '').trim();
}

function securityGroupIngressBlocks(portsValue, cidrsValue) {
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

function securityGroupEgressBlock(cidrsValue) {
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

function formatListExpression(value) {
  const text = String(value).trim();
  if (looksLikeTerraformExpression(text)) return text.replace(/^\${(.+)}$/, '$1');
  return formatStringList(splitList(text));
}

function formatStringList(values) {
  return `[${values.map((value) => formatValue(value)).join(', ')}]`;
}

function splitList(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function looksLikeTerraformExpression(value) {
  return /^\${.+}$/.test(value) || /^(data\.|aws_|var\.|local\.|module\.|filebase64sha256\(|jsonencode\(|\[|\{)/.test(value);
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
