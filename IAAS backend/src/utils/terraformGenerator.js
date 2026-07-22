const terraformTypeByServiceId = {
  alb: 'aws_lb',
  apigw: 'aws_apigatewayv2_api',
  beanstalk: 'aws_elastic_beanstalk_environment',
  cloudfront: 'aws_cloudfront_distribution',
  cloudwatch: 'aws_cloudwatch_metric_alarm',
  codebuild: 'aws_codebuild_project',
  codepipeline: 'aws_codepipeline',
  cognito: 'aws_cognito_user_pool',
  docdb: 'aws_docdb_cluster',
  'docdb-instance': 'aws_docdb_cluster_instance',
  'docdb-subnet-group': 'aws_docdb_subnet_group',
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
  'lb-listener': 'aws_lb_listener',
  'lb-target-attachment': 'aws_lb_target_group_attachment',
  'lb-target-group': 'aws_lb_target_group',
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
export const latestAmazonLinux2023Ami = 'data.aws_ami.amazon_linux_2023.id';

const outputAttributesByServiceId = {
  ec2: ['id', 'arn', 'public_ip', 'private_ip', 'public_dns', 'private_dns', 'availability_zone', 'key_pair_name', 'ssh_private_key_pem'],
  lambda: ['arn', 'invoke_arn', 'function_name', 'qualified_arn', 'version'],
  rds: ['arn', 'address', 'endpoint', 'port', 'resource_id'],
  s3: ['id', 'arn', 'bucket_domain_name', 'bucket_regional_domain_name'],
  vpc: ['id', 'arn', 'cidr_block', 'default_security_group_id'],
  subnet: ['id', 'arn', 'cidr_block', 'availability_zone'],
  'security-group': ['id', 'arn', 'name', 'owner_id'],
  alb: ['arn', 'dns_name', 'zone_id'],
  apigw: ['id', 'api_endpoint', 'execution_arn'],
  dynamodb: ['arn', 'id', 'stream_arn'],
  sqs: ['arn', 'id', 'url'],
  sns: ['arn', 'id'],
  iam: ['arn', 'name', 'unique_id'],
  secrets: ['arn', 'id', 'name'],
  kms: ['arn', 'key_id'],
  ecr: ['arn', 'repository_url', 'registry_id'],
  cloudfront: ['id', 'arn', 'domain_name', 'hosted_zone_id'],
  route53: ['id', 'fqdn', 'name'],
  ecs: ['id', 'name'],
  docdb: ['id', 'arn', 'endpoint', 'reader_endpoint', 'port'],
  'docdb-instance': ['id', 'arn', 'endpoint'],
  'lb-target-group': ['id', 'arn'],
  'lb-listener': ['id', 'arn'],
  waf: ['arn', 'id', 'capacity'],
};

export function generateTerraform(nodes = [], edges = [], options = {}) {
  const region = options.region ?? firstRegion(nodes) ?? 'ap-south-1';
  const suffix = sanitizeName(options.suffix ?? 'diagram').slice(0, 16) || 'diagram';
  const serviceNodes = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId);
  const deployableNodes = serviceNodes.filter((node) => deployableServices.has(node.data.serviceId));
  const unsupportedNodes = serviceNodes.filter((node) => !deployableServices.has(node.data.serviceId));
  const names = Object.fromEntries(deployableNodes.map((node) => [node.id, resourceName(node, suffix)]));
  const createsManagedEc2Keys = deployableNodes.some(shouldCreateManagedEc2KeyPair);
  const includesUsEast1Provider = deployableNodes.some(
    (node) =>
      (node.data?.serviceId === 'waf' && configString(node.data?.config, 'scope') === 'CLOUDFRONT') ||
      (node.data?.serviceId === 'cloudwatch' && configString(node.data?.config, 'namespace') === 'AWS/CloudFront'),
  );
  const blocks = dedupeTerraformBlocks([
    terraformHeader(region, createsManagedEc2Keys, includesUsEast1Provider),
    ...awsDataSourceBlocks(deployableNodes),
    ...ec2AmiDataBlocks(deployableNodes),
    ...ec2ManagedKeyPairBlocks(deployableNodes, names, suffix),
    ...ec2InstanceProfileBlocks(deployableNodes, suffix),
    ...deployableNodes.flatMap((node) => resourceBlocksForNode(node, names[node.id], suffix, deployableNodes, edges, names)),
    ...connectionBlocks(deployableNodes, edges, names),
    resourceOutputBlock(deployableNodes, names),
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

function terraformHeader(region, includeTlsProvider = false, includeUsEast1Provider = false) {
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
  default_tags {
    tags = {
      ManagedBy = "infraflow"
    }
  }
}${includeUsEast1Provider ? `

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      ManagedBy = "infraflow"
    }
  }
}` : ''}`;
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
  if (!nodes.some((node) => node.data?.serviceId === 'ec2' && ec2AmiExpression(node.data?.config) === latestAmazonLinux2023Ami)) return [];

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

  if (nodes.some((node) => node.data?.serviceId === 'ecs')) {
    blocks.push(`data "aws_region" "current" {}`);
  }

  return blocks;
}

function ec2ManagedKeyPairBlocks(nodes, names, suffix) {
  return nodes.filter(shouldCreateManagedEc2KeyPair).flatMap((node) => {
    const label = node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId;
    const keyResourceName = managedEc2KeyPairResourceName(names[node.id]);
    const keyName = `${uniqueAwsName(label, suffix)}-key`.slice(0, 128);

    return [
      `resource "tls_private_key" "${keyResourceName}" {
  algorithm = "RSA"
  rsa_bits  = 4096
}`,
      `resource "aws_key_pair" "${keyResourceName}" {
  key_name   = ${formatValue(keyName)}
  public_key = tls_private_key.${keyResourceName}.public_key_openssh
}`,
    ];
  });
}

function resourceBlocksForNode(node, name, suffix, nodes = [], edges = [], names = {}) {
  const config = node.data?.config ?? {};
  const label = node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId;
  const uniqueName = configString(config, 'name') || uniqueAwsName(label, suffix);

  switch (node.data.serviceId) {
    case 'alb': {
      const sgRefs = connectedRefList(node, nodes, edges, names, 'security-group');
      const sgExpr = resolveListExpression(config, 'security_groups', sgRefs);
      const sgLine = sgExpr !== '[]' ? `  security_groups    = ${sgExpr}\n` : '';
      return [
        `resource "aws_lb" "${name}" {
  name               = ${formatValue(uniqueName)}
  load_balancer_type = ${formatValue(configString(config, 'load_balancer_type') || 'application')}
  internal           = ${formatBoolean(config.internal ?? 'false')}
  subnets            = ${resolveListExpression(config, 'subnets', connectedRefList(node, nodes, edges, names, 'subnet'))}
${sgLine}}`,
      ];
    }
    case 'lb-target-group':
      return [
        `resource "aws_lb_target_group" "${name}" {
  name        = ${formatValue(uniqueName)}
  port        = ${formatNumber(config.port ?? 80)}
  protocol    = ${formatValue(configString(config, 'protocol') || 'HTTP')}
  vpc_id      = ${formatMaybeExpression(configString(config, 'vpc_id') || connectedRef(node, nodes, edges, names, 'vpc'))}
  target_type = ${formatValue(configString(config, 'target_type') || 'ip')}

  health_check {
    path                = ${formatValue(configString(config, 'health_check_path') || '/')}
    matcher             = "200-399"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}`,
      ];
    case 'lb-listener':
      return [
        `resource "aws_lb_listener" "${name}" {
  load_balancer_arn = ${formatMaybeExpression(configString(config, 'load_balancer_arn') || connectedRef(node, nodes, edges, names, 'alb'))}
  port              = ${formatNumber(config.port ?? 80)}
  protocol          = ${formatValue(configString(config, 'protocol') || 'HTTP')}

  default_action {
    type             = "forward"
    target_group_arn = ${formatMaybeExpression(configString(config, 'target_group_arn') || connectedRef(node, nodes, edges, names, 'lb-target-group'))}
  }
}`,
      ];
    case 'ecs':
      return ecsResourceBlocks(node, name, suffix, nodes, edges, names, config, uniqueName, label);
    case 'rds': {
      const subnetRefs = connectedRefList(node, nodes, edges, names, 'subnet');
      const sgRefs = connectedRefList(node, nodes, edges, names, 'security-group');
      const extraBlocks = [];
      const rdsConfig = { ...config };
      if (isEmptyValue(rdsConfig.identifier)) rdsConfig.identifier = uniqueName;

      let subnetGroupLine = '';
      if (subnetRefs.length && isEmptyValue(rdsConfig.db_subnet_group_name)) {
        const subnetGroupName = `${name}_subnet_group`;
        extraBlocks.push(`resource "aws_db_subnet_group" "${subnetGroupName}" {
  name       = ${formatValue(`${uniqueName}-subnets`.slice(0, 255))}
  subnet_ids = ${resolveListExpression({}, 'subnet_ids', subnetRefs)}
}`);
        subnetGroupLine = `  db_subnet_group_name = aws_db_subnet_group.${subnetGroupName}.name\n`;
      }

      const sgLine = sgRefs.length && isEmptyValue(rdsConfig.vpc_security_group_ids)
        ? `  vpc_security_group_ids = ${resolveListExpression({}, 'vpc_security_group_ids', sgRefs)}\n`
        : '';

      const body = Object.entries(rdsConfig)
        .filter(([, value]) => !isEmptyValue(value))
        .filter(([key]) => !['region', 'status'].includes(key))
        .map(([key, value]) => `  ${key} = ${formatMaybeExpression(value)}`)
        .join('\n');

      return [...extraBlocks, `resource "aws_db_instance" "${name}" {\n${body}\n${subnetGroupLine}${sgLine}}`];
    }
    case 'docdb-subnet-group':
      return [
        `resource "aws_docdb_subnet_group" "${name}" {
  name       = ${formatValue(uniqueName)}
  subnet_ids = ${formatExpressionList(Array.from(new Set([
    ...parseSimpleListExpression(configString(config, 'subnet_ids')) ?? [],
    ...connectedRefList(node, nodes, edges, names, 'subnet'),
  ])))}
}`,
      ];
    case 'docdb': {
      const subnetGroupNode = connectedServiceNode(node, nodes, edges, 'docdb-subnet-group');
      const subnetGroupLine = subnetGroupNode && names[subnetGroupNode.id]
        ? `  db_subnet_group_name   = aws_docdb_subnet_group.${names[subnetGroupNode.id]}.name\n`
        : '';
      const sgRefs = [
        ...parseSimpleListExpression(configString(config, 'vpc_security_group_ids')) ?? [],
        ...connectedRefList(node, nodes, edges, names, 'security-group'),
      ];
      const sgLine = sgRefs.length ? `  vpc_security_group_ids  = ${formatExpressionList(Array.from(new Set(sgRefs)))}\n` : '';
      return [
        `resource "aws_docdb_cluster" "${name}" {
  cluster_identifier      = ${formatValue(configString(config, 'cluster_identifier') || uniqueName)}
  engine                  = ${formatValue(configString(config, 'engine') || 'docdb')}
  master_username         = ${formatMaybeExpression(configString(config, 'master_username'))}
  master_password         = ${formatMaybeExpression(configString(config, 'master_password'))}
  skip_final_snapshot     = ${formatBoolean(config.skip_final_snapshot ?? 'true')}
  storage_encrypted       = true
${subnetGroupLine}${sgLine}}`,
      ];
    }
    case 'docdb-instance': {
      const clusterNode = connectedServiceNode(node, nodes, edges, 'docdb');
      const clusterRef = clusterNode && names[clusterNode.id] ? `aws_docdb_cluster.${names[clusterNode.id]}.id` : '';
      return [
        `resource "aws_docdb_cluster_instance" "${name}" {
  identifier         = ${formatValue(configString(config, 'identifier') || uniqueName)}
  cluster_identifier = ${formatMaybeExpression(configString(config, 'cluster_identifier') || clusterRef)}
  instance_class     = ${formatValue(configString(config, 'instance_class') || 'db.t3.medium')}
  engine             = ${formatValue(configString(config, 'engine') || 'docdb')}
}`,
      ];
    }
    case 'apigw':
      return [
        `resource "aws_apigatewayv2_api" "${name}" {
  name          = ${formatValue(uniqueName)}
  protocol_type = ${formatValue(configString(config, 'protocol_type') || 'HTTP')}
}`,
      ];
    case 'cloudwatch':
      const cloudWatchProviderLine = configString(config, 'namespace') === 'AWS/CloudFront' ? '  provider            = aws.us_east_1\n' : '';
      return [
        `resource "aws_cloudwatch_metric_alarm" "${name}" {
${cloudWatchProviderLine}  alarm_name          = ${formatValue(configString(config, 'alarm_name') || uniqueName)}
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
      const originNode = connectedServiceNode(node, nodes, edges, 's3') ?? nodes.find((candidate) => candidate.data?.serviceId === 's3');
      const originName = originNode ? names[originNode.id] : '';
      const originId = originName ? `s3-${originName}` : `${name}-origin`;
      const originDomain = originName ? `aws_s3_bucket.${originName}.bucket_regional_domain_name` : formatValue(configString(config, 'origin_domain_name') || 'replace-with-origin.example.com');
      const wafNode = connectedServiceNode(node, nodes, edges, 'waf');
      const wafLine = wafNode && names[wafNode.id] ? `  web_acl_id          = aws_wafv2_web_acl.${names[wafNode.id]}.arn\n` : '';

      return [
        `resource "aws_cloudfront_distribution" "${name}" {
  enabled             = ${formatBoolean(config.enabled)}
  comment             = ${formatValue(configString(config, 'comment') || uniqueName)}
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
      const keyNameLine = configString(config, 'key_name')
        ? optionalLine('key_name', config.key_name)
        : `  key_name = aws_key_pair.${managedEc2KeyPairResourceName(name)}.key_name\n`;
      return [
        `resource "aws_instance" "${name}" {
  ami           = ${formatMaybeExpression(ec2AmiExpression(config))}
  instance_type = ${formatValue(configString(config, 'instance_type'))}
${keyNameLine}${optionalExpressionLine('subnet_id', config.subnet_id)}${ec2SecurityGroupIdsLine(node, nodes, edges, names)}${optionalLine('associate_public_ip_address', config.associate_public_ip_address)}${instanceProfile ? `  iam_instance_profile = ${instanceProfile}\n` : ''}

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
    case 'iam': {
      const forLambda = Boolean(connectedServiceNode(node, nodes, edges, 'lambda'));
      const trustPolicy = configString(config, 'assume_role_policy') || (forLambda
        ? `jsonencode({"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]})`
        : '');
      const blocks = [
        `resource "aws_iam_role" "${name}" {
  name               = ${formatValue(uniqueName)}
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
    case 'lambda': {
      const roleRef = configString(config, 'role_arn') || connectedRef(node, nodes, edges, names, 'iam', 'arn');
      return [
        `resource "aws_lambda_function" "${name}" {
  function_name    = ${formatValue(configString(config, 'function_name') || uniqueName)}
  role             = ${formatMaybeExpression(roleRef)}
  filename         = ${formatValue(configString(config, 'filename'))}
  source_code_hash = ${formatMaybeExpression(configString(config, 'source_code_hash'))}
  handler          = ${formatValue(configString(config, 'handler'))}
  runtime          = ${formatValue(configString(config, 'runtime'))}
  memory_size      = ${formatNumber(config.memory_size)}
  timeout          = ${formatNumber(config.timeout)}
}`,
      ];
    }
    case 'igw':
      return [
        `resource "aws_internet_gateway" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id') || connectedRef(node, nodes, edges, names, 'vpc'))}

  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 'route':
      return [
        `resource "aws_route" "${name}" {
  route_table_id         = ${formatMaybeExpression(configString(config, 'route_table_id') || connectedRef(node, nodes, edges, names, 'route-table'))}
  destination_cidr_block = ${formatValue(configString(config, 'destination_cidr_block') || '0.0.0.0/0')}
  gateway_id             = ${formatMaybeExpression(configString(config, 'gateway_id') || connectedRef(node, nodes, edges, names, 'igw'))}
}`,
      ];
    case 'route-association':
      return [
        `resource "aws_route_table_association" "${name}" {
  subnet_id      = ${formatMaybeExpression(configString(config, 'subnet_id') || connectedRef(node, nodes, edges, names, 'subnet'))}
  route_table_id = ${formatMaybeExpression(configString(config, 'route_table_id') || connectedRef(node, nodes, edges, names, 'route-table'))}
}`,
      ];
    case 'route53': {
      const cloudfrontNode = connectedServiceNode(node, nodes, edges, 'cloudfront');
      const cloudfrontName = cloudfrontNode ? names[cloudfrontNode.id] : '';
      const recordType = configString(config, 'type') || 'A';
      const common = `resource "aws_route53_record" "${name}" {
  zone_id = ${formatMaybeExpression(configString(config, 'zone_id'))}
  name    = ${formatValue(configString(config, 'name') || uniqueName)}
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
    case 'route-table':
      return [
        `resource "aws_route_table" "${name}" {
  vpc_id = ${formatMaybeExpression(configString(config, 'vpc_id') || connectedRef(node, nodes, edges, names, 'vpc'))}

  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 's3': {
      const bucketLine = configString(config, 'bucket')
        ? `  bucket = ${formatValue(configString(config, 'bucket'))}`
        : `  bucket_prefix = ${formatValue(configString(config, 'bucket_prefix') || uniqueBucketName(label, suffix).slice(0, 37) + '-')}`;
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

      const kmsNode = connectedServiceNode(node, nodes, edges, 'kms');
      const kmsName = kmsNode ? names[kmsNode.id] : '';
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
  description = ${formatValue(configString(config, 'description') || 'Managed by infraflow')}
  vpc_id      = ${formatMaybeExpression(configString(config, 'vpc_id') || connectedRef(node, nodes, edges, names, 'vpc'))}
${securityGroupIngressBlocks(configString(config, 'ingress_ports'), configString(config, 'ingress_cidr_blocks'))}${securityGroupEgressBlock(configString(config, 'egress_cidr_blocks'))}
  tags = {
    Name = ${formatValue(uniqueName || label)}
  }
}`,
      ];
    case 'subnet':
      return [
        `resource "aws_subnet" "${name}" {
  vpc_id                  = ${formatMaybeExpression(configString(config, 'vpc_id') || connectedRef(node, nodes, edges, names, 'vpc'))}
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
    case 'waf': {
      const defaultAction = configString(config, 'default_action') === 'block' ? 'block' : 'allow';
      const metricName = configString(config, 'metric_name') || sanitizeMetricName(uniqueName);
      const providerLine = configString(config, 'scope') === 'CLOUDFRONT' ? '  provider = aws.us_east_1\n' : '';
      return [
        `resource "aws_wafv2_web_acl" "${name}" {
${providerLine}  name  = ${formatValue(uniqueName)}
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
    default:
      return genericResourceBlock(node, name, suffix);
  }
}

// A single ECS diagram node expands into a full Fargate stack: cluster (unless an external one is
// referenced), execution role, log group, task definition, and the service itself. Networking
// (subnets/security groups) and load balancer wiring are pulled from connected diagram nodes.
function ecsResourceBlocks(node, name, suffix, nodes, edges, names, config, uniqueName, label) {
  const blocks = [];

  const explicitCluster = configString(config, 'cluster');
  let clusterRef = explicitCluster;
  if (!explicitCluster) {
    const clusterName = `${name}_cluster`;
    blocks.push(`resource "aws_ecs_cluster" "${clusterName}" {
  name = ${formatValue(uniqueName)}
}`);
    clusterRef = `aws_ecs_cluster.${clusterName}.id`;
  }

  const executionRoleName = `${name}_execution_role`;
  blocks.push(`resource "aws_iam_role" "${executionRoleName}" {
  name = ${formatValue(`${uniqueName}-execution`.slice(0, 64))}
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}`);
  blocks.push(`resource "aws_iam_role_policy_attachment" "${executionRoleName}_managed" {
  role       = aws_iam_role.${executionRoleName}.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}`);

  const secretsNode = connectedServiceNode(node, nodes, edges, 'secrets');
  if (secretsNode && names[secretsNode.id]) {
    blocks.push(`resource "aws_iam_role_policy" "${executionRoleName}_secrets" {
  name = "${uniqueName}-secrets-read"
  role = aws_iam_role.${executionRoleName}.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.${names[secretsNode.id]}.arn
    }]
  })
}`);
  }

  const logGroupName = `${name}_logs`;
  blocks.push(`resource "aws_cloudwatch_log_group" "${logGroupName}" {
  name              = ${formatValue(`/ecs/${uniqueName}`)}
  retention_in_days = 14
}`);

  const containerPort = numberValue(config.container_port, 8080);
  const ecrNode = connectedServiceNode(node, nodes, edges, 'ecr');
  const image = ecrNode && names[ecrNode.id]
    ? `\${aws_ecr_repository.${names[ecrNode.id]}.repository_url}:latest`
    : configString(config, 'image') || 'public.ecr.aws/docker/library/nginx:latest';
  const secretEnvVarName = configString(config, 'secret_env_var_name') || 'APP_SECRET';
  const secretsLine = secretsNode && names[secretsNode.id]
    ? `,\n      "secrets": [{ "name": ${formatValue(secretEnvVarName)}, "valueFrom": "${'${'}aws_secretsmanager_secret.${names[secretsNode.id]}.arn}" }]`
    : '';

  const taskDefName = `${name}_task`;
  blocks.push(`resource "aws_ecs_task_definition" "${taskDefName}" {
  family                   = ${formatValue(uniqueName)}
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = ${formatValue(String(configString(config, 'cpu') || '256'))}
  memory                   = ${formatValue(String(configString(config, 'memory') || '512'))}
  execution_role_arn       = aws_iam_role.${executionRoleName}.arn

  container_definitions = jsonencode([
    {
      "name": ${formatValue(name)},
      "image": "${image}",
      "portMappings": [{ "containerPort": ${containerPort}, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "${'${'}aws_cloudwatch_log_group.${logGroupName}.name}",
          "awslogs-region": data.aws_region.current.name,
          "awslogs-stream-prefix": "ecs"
        }
      }${secretsLine}
    }
  ])
}`);

  const subnetRefs = connectedRefList(node, nodes, edges, names, 'subnet');
  const sgRefs = connectedRefList(node, nodes, edges, names, 'security-group');
  const targetGroupNode = connectedServiceNode(node, nodes, edges, 'lb-target-group');
  const loadBalancerBlock = targetGroupNode && names[targetGroupNode.id]
    ? `
  load_balancer {
    target_group_arn = aws_lb_target_group.${names[targetGroupNode.id]}.arn
    container_name    = ${formatValue(name)}
    container_port    = ${containerPort}
  }
`
    : '';
  const listenerNode = targetGroupNode ? connectedServiceNode(targetGroupNode, nodes, edges, 'lb-listener') : undefined;
  const dependsOnLine = listenerNode && names[listenerNode.id] ? `\n  depends_on = [aws_lb_listener.${names[listenerNode.id]}]` : '';

  blocks.push(`resource "aws_ecs_service" "${name}" {
  name            = ${formatValue(uniqueName)}
  cluster         = ${formatMaybeExpression(clusterRef)}
  task_definition = aws_ecs_task_definition.${taskDefName}.arn
  desired_count   = ${formatNumber(config.desired_count ?? 1)}
  launch_type     = ${formatValue(configString(config, 'launch_type') || 'FARGATE')}

  network_configuration {
    subnets          = ${resolveListExpression(config, 'subnets', subnetRefs)}
    security_groups  = ${resolveListExpression(config, 'security_groups', sgRefs)}
    assign_public_ip = ${formatBoolean(config.assign_public_ip ?? 'true')}
  }
${loadBalancerBlock}${dependsOnLine}
}`);

  return blocks;
}

// Config key that AWS requires to be unique (per region/account, or globally for a few types) for
// resource types handled by the generic fallback below. When that field is left blank, genericResourceBlock
// fills it with an auto-generated per-diagram unique name instead of omitting the argument entirely.
const identifierFieldByServiceId = {
  ecr: 'name',
  eks: 'name',
  elasticache: 'cluster_id',
  redshift: 'cluster_identifier',
  kinesis: 'name',
  cognito: 'name',
  codebuild: 'name',
  codepipeline: 'name',
  beanstalk: 'name',
};

function connectedServiceNode(node, nodes, edges, serviceId) {
  return connectedServiceNodes(node, nodes, edges, serviceId)[0];
}

// Resolves a Terraform attribute reference (e.g. "aws_vpc.app_vpc.id") for the first node of
// `serviceId` connected to `node` via a diagram edge. Lets fields like vpc_id/subnet_id be wired
// up purely by drawing a connection in the diagram, instead of requiring a hand-typed reference.
function connectedRef(node, nodes, edges, names, serviceId, attr = 'id') {
  const other = connectedServiceNode(node, nodes, edges, serviceId);
  if (!other || !names[other.id]) return '';
  const terraformType = terraformTypeByServiceId[other.data?.serviceId];
  if (!terraformType) return '';
  return `${terraformType}.${names[other.id]}.${attr}`;
}

function connectedRefList(node, nodes, edges, names, serviceId, attr = 'id') {
  return connectedServiceNodes(node, nodes, edges, serviceId)
    .filter((other) => names[other.id] && terraformTypeByServiceId[other.data?.serviceId])
    .map((other) => `${terraformTypeByServiceId[other.data.serviceId]}.${names[other.id]}.${attr}`);
}

// Resolves a list-typed field (subnets, security_groups, ...). If the config value is itself a
// whole expression that already evaluates to a list (e.g. "data.aws_subnets.default.ids" — for
// templates that use the account's default VPC instead of a diagram-managed one), it's used as-is
// rather than being wrapped in another [...]. Otherwise it's merged with any connected-node refs
// into a literal list.
function resolveListExpression(config, key, connectedRefs) {
  const explicit = configString(config, key);
  if (explicit && !explicit.startsWith('[') && looksLikeTerraformExpression(explicit)) {
    return explicit;
  }
  const merged = Array.from(new Set([...(parseSimpleListExpression(explicit) ?? []), ...connectedRefs]));
  return formatExpressionList(merged);
}

function connectedServiceNodes(node, nodes, edges, serviceId) {
  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  const results = [];
  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = nodeById[otherId];
    if (otherNode?.data?.serviceId === serviceId && !seen.has(otherId)) {
      seen.add(otherId);
      results.push(otherNode);
    }
  }
  return results;
}

function genericResourceBlock(node, name, suffix) {
  const terraformType = terraformTypeByServiceId[node.data?.serviceId];
  if (!terraformType) return [];

  const config = { ...(node.data?.config ?? {}) };
  const identifierField = identifierFieldByServiceId[node.data?.serviceId];
  if (identifierField && isEmptyValue(config[identifierField])) {
    const label = node.data?.label ?? node.data?.serviceName ?? node.data?.serviceId;
    config[identifierField] = uniqueAwsName(label, suffix);
  }

  const body = Object.entries(config)
    .filter(([, value]) => !isEmptyValue(value))
    .filter(([key]) => !['region', 'status'].includes(key))
    .map(([key, value]) => `  ${key} = ${formatMaybeExpression(value)}`)
    .join('\n');

  return [`resource "${terraformType}" "${name}" {\n${body || '  # Fill this service form before deployment.'}\n}`];
}

function resourceOutputBlock(nodes, names) {
  const hasManagedEc2Keys = nodes.some(shouldCreateManagedEc2KeyPair);
  const entries = nodes
    .filter((node) => terraformTypeByServiceId[node.data?.serviceId] && names[node.id])
    .map((node) => {
      const serviceId = node.data.serviceId;
      const terraformType = terraformTypeByServiceId[serviceId];
      const resourceName = names[node.id];
      const outputs = outputAttributesForNode(node);
      const attrs = outputs.map((attr) => outputAttributeExpression(node, terraformType, resourceName, attr)).join('\n');

      return `    ${resourceName} = {
      label = ${formatValue(node.data?.label ?? node.data?.serviceName ?? serviceId)}
      service = ${formatValue(node.data?.serviceName ?? serviceId)}
      terraform_address = ${formatValue(`${terraformType}.${resourceName}`)}
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

function outputAttributeExpression(node, terraformType, resourceName, attr) {
  if (node.data?.serviceId === 'ec2' && attr === 'key_pair_name') {
    return shouldCreateManagedEc2KeyPair(node)
      ? `      ${attr} = try(aws_key_pair.${managedEc2KeyPairResourceName(resourceName)}.key_name, null)`
      : `      ${attr} = try(${terraformType}.${resourceName}.key_name, null)`;
  }

  if (node.data?.serviceId === 'ec2' && attr === 'ssh_private_key_pem') {
    return shouldCreateManagedEc2KeyPair(node)
      ? `      ${attr} = try(tls_private_key.${managedEc2KeyPairResourceName(resourceName)}.private_key_pem, null)`
      : `      ${attr} = null`;
  }

  if (node.data?.serviceId === 's3' && ['website_endpoint', 'website_domain'].includes(attr)) {
    return `      ${attr} = try(aws_s3_bucket_website_configuration.${resourceName}_website.${attr}, null)`;
  }

  return `      ${attr} = try(${terraformType}.${resourceName}.${attr}, null)`;
}

function outputAttributesForNode(node) {
  const outputs = outputAttributesByServiceId[node.data?.serviceId] ?? ['id', 'arn'];
  if (node.data?.serviceId === 's3' && configString(node.data?.config, 'website_index_document')) {
    return [...outputs, 'website_endpoint', 'website_domain'];
  }
  return outputs;
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
  return sanitizeName(`infraflow-${label}-${suffix}`).replaceAll('_', '-').slice(0, 64);
}

function uniqueBucketName(label, suffix) {
  return uniqueAwsName(label, suffix).toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 63);
}

function sanitizeMetricName(value) {
  return String(value || 'infraflowMetric').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'infraflowMetric';
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

// Like formatMaybeExpression, but for fields (like assume_role_policy) that Terraform expects to
// be a *string* containing JSON. Raw pasted JSON ("{...}"/"[...]") is wrapped in jsonencode(...) so
// it evaluates to a string, instead of being emitted as a bare HCL object (wrong type — Terraform
// would reject it with "Inappropriate value ... string required"). Genuine Terraform expressions
// (data.x.json, var.x, an already-wrapped jsonencode(...), ${...}) still pass through unquoted.
function formatJsonOrExpression(value) {
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

function configString(config, key) {
  return String(config?.[key] ?? '').trim();
}

function ec2AmiExpression(config) {
  return configString(config, 'ami') || latestAmazonLinux2023Ami;
}

function shouldCreateManagedEc2KeyPair(node) {
  return node.data?.serviceId === 'ec2' && !configString(node.data?.config, 'key_name');
}

function managedEc2KeyPairResourceName(resourceName) {
  return `ec2_key_${resourceName}`.slice(0, 48);
}

function ec2SecurityGroupIdsLine(node, nodes, edges, names) {
  const declaredSecurityGroupNames = new Set(nodes.filter((candidate) => candidate.data?.serviceId === 'security-group').map((candidate) => names[candidate.id]).filter(Boolean));
  const expression = mergeListExpression(
    configString(node.data?.config, 'vpc_security_group_ids'),
    securityGroupRefsForEc2(node, nodes, edges, names),
    declaredSecurityGroupNames,
  );
  return expression ? `  vpc_security_group_ids = ${expression}\n` : '';
}

function securityGroupRefsForEc2(node, nodes, edges, names) {
  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  const refs = [];

  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;

    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = nodeById[otherId];
    if (otherNode?.data?.serviceId !== 'security-group') continue;

    refs.push(`aws_security_group.${names[otherNode.id]}.id`);
  }

  return Array.from(new Set(refs.filter(Boolean)));
}

function mergeListExpression(configValue, inferredRefs, declaredSecurityGroupNames = new Set()) {
  const explicit = sanitizeConfiguredListExpression(String(configValue ?? '').trim(), declaredSecurityGroupNames);
  const missingRefs = inferredRefs.filter((ref) => !explicit.includes(ref));

  if (!explicit && !missingRefs.length) return '';
  if (!explicit) return `[${missingRefs.join(', ')}]`;

  const explicitExpression = formatListExpression(explicit);
  if (!missingRefs.length) return explicitExpression;

  return `distinct(concat(${explicitExpression}, [${missingRefs.join(', ')}]))`;
}

function sanitizeConfiguredListExpression(value, declaredSecurityGroupNames) {
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

function parseSimpleListExpression(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (/^(distinct|concat|flatten|toset|tolist)\s*\(/.test(text)) return undefined;

  const listMatch = text.match(/^\[(.*)\]$/s);
  const body = listMatch ? listMatch[1] : text;
  return body.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function formatListEntry(entry) {
  if (/^".*"$/.test(entry) || /^'.*'$/.test(entry) || looksLikeTerraformExpression(entry)) return entry;
  return formatValue(entry);
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

// Like formatStringList, but leaves Terraform resource references (aws_x.y.id) unquoted instead
// of treating every entry as a literal string.
function formatExpressionList(values) {
  return `[${values.map(formatListEntry).join(', ')}]`;
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
