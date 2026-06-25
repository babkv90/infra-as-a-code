import { latestAmazonLinux2023Ami, serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode, NodeBinding } from '../types';

export function exportTerraform(nodes: AwsNode[], edges: AwsEdge[], selectedNodeId?: string): string {
  const targetNodes = selectedNodeId ? nodes.filter((node) => node.id === selectedNodeId) : nodes;
  const serviceNodes = targetNodes.filter((node) => node.type !== 'groupBox' && node.data.serviceId);
  const region = firstRegion(serviceNodes) ?? 'ap-south-1';
  const resourceBlocks = dedupeTerraformBlocks([
    ...awsDataSourceBlocks(serviceNodes),
    ...ec2AmiDataBlocks(serviceNodes),
    ...bindingSupportBlocks(serviceNodes, nodes),
    ...ec2InstanceProfileBlocks(serviceNodes),
    ...serviceNodes.flatMap((node) => resourceBlocksForNode(node, nodes, edges)),
  ]);

  if (selectedNodeId) {
    return [terraformHeader(region), ...resourceBlocks].join('\n\n') || '# Select an AWS service node to export Terraform.';
  }

  const edgeNotes = edges.length
    ? `\n\n# Connections\n${edges
        .map((edge) => `# ${nodeName(nodes, edge.source)} -> ${nodeName(nodes, edge.target)} (${edge.data?.connectionType ?? 'data'}: ${edge.data?.label || 'unlabeled'})`)
        .join('\n')}`
    : '';

  return `${[terraformHeader(region), ...resourceBlocks].join('\n\n') || '# Add nodes to generate Terraform.'}${edgeNotes}`;
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'resource';
}

function terraformHeader(region: string): string {
  return `provider "aws" {
  region = "${escapeString(region)}"
}`;
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

      return [
        `resource "aws_instance" "${name}" {
  ami           = ${formatMaybeExpression(ec2AmiExpression(config))}
  instance_type = ${formatValue(configString(config, 'instance_type'))}
${optionalExpressionLine('subnet_id', config.subnet_id)}${ec2SecurityGroupIdsLine(node, allNodes, edges)}${optionalLine('associate_public_ip_address', config.associate_public_ip_address)}${profileReference ? `  iam_instance_profile = ${profileReference}\n` : ''}

  tags = {
    Name = ${formatValue(awsName || label)}
  }
}`,
      ];
    }
    case 'lambda':
      return [
        `resource "aws_lambda_function" "${name}" {
  function_name    = ${formatValue(configString(config, 'function_name') || awsName)}
  role             = ${formatValue(configString(config, 'role_arn'))}
  filename         = ${formatValue(configString(config, 'filename'))}
  source_code_hash = ${formatMaybeExpression(configString(config, 'source_code_hash'))}
  handler          = ${formatValue(configString(config, 'handler'))}
  runtime          = ${formatValue(configString(config, 'runtime'))}
  memory_size      = ${formatNumber(config.memory_size)}
  timeout          = ${formatNumber(config.timeout)}
${lambdaEnvironmentBlock(node, allNodes)}
}`,
      ];
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
    case 'security-group':
      return [
        `resource "aws_security_group" "${name}" {
  name        = ${formatValue(awsName)}
  description = ${formatValue(configString(config, 'description') || 'Managed by InfraPilot AI')}
  vpc_id      = ${formatMaybeExpression(configString(config, 'vpc_id'))}
${securityGroupIngressBlocks(configString(config, 'ingress_ports'), configString(config, 'ingress_cidr_blocks'))}${securityGroupEgressBlock(configString(config, 'egress_cidr_blocks'))}
  tags = {
    Name = ${formatValue(awsName || label)}
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
      return [
        `resource "aws_cloudwatch_metric_alarm" "${name}" {
  alarm_name          = ${formatValue(configString(config, 'alarm_name') || awsName)}
  comparison_operator = ${formatValue(configString(config, 'comparison_operator'))}
  evaluation_periods  = ${formatNumber(config.evaluation_periods)}
  metric_name         = ${formatValue(configString(config, 'metric_name'))}
  namespace           = ${formatValue(configString(config, 'namespace'))}
  period              = ${formatNumber(config.period)}
  statistic           = ${formatValue(configString(config, 'statistic'))}
  threshold           = ${formatNumber(config.threshold)}
}`,
      ];
    case 'apigw':
      return [
        `resource "aws_apigatewayv2_api" "${name}" {
  name          = ${formatValue(awsName)}
  protocol_type = ${formatValue(configString(config, 'protocol_type'))}
}`,
      ];
    case 'iam':
      return [
        `resource "aws_iam_role" "${name}" {
  name               = ${formatValue(awsName)}
  assume_role_policy = ${formatMaybeExpression(configString(config, 'assume_role_policy'))}
}`,
      ];
    default: {
      const fallbackConfig = Object.entries(config)
        .filter(([, value]) => !isEmptyValue(value))
        .filter(([key]) => !['region', 'status'].includes(key))
        .map(([key, value]) => `  ${key} = ${formatMaybeExpression(value)}`)
        .join('\n');

      return [`resource "${service?.terraformType ?? 'aws_resource'}" "${name}" {\n${fallbackConfig || '  # Add required arguments'}\n}`];
    }
  }
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

function ec2SecurityGroupIdsLine(node: AwsNode, allNodes: AwsNode[], edges: AwsEdge[]): string {
  const expression = mergeListExpression(configString(node.data.config, 'vpc_security_group_ids'), securityGroupRefsForEc2(node, allNodes, edges));
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

function mergeListExpression(configValue: string, inferredRefs: string[]): string {
  const explicit = configValue.trim();
  const missingRefs = inferredRefs.filter((ref) => !explicit.includes(ref));

  if (!explicit && !missingRefs.length) return '';
  if (!explicit) return `[${missingRefs.join(', ')}]`;

  const explicitExpression = formatListExpression(explicit);
  if (!missingRefs.length) return explicitExpression;

  return `distinct(concat(${explicitExpression}, [${missingRefs.join(', ')}]))`;
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
  return sanitizeName(`infrapilot-${label}`).replace(/_/g, '-').slice(0, 64);
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
