export function validateDiagram(nodes = [], edges = [], region) {
  const issues = [];
  const serviceIds = new Set(nodes.map((node) => node?.data?.serviceId).filter(Boolean));
  const serviceNodes = nodes.filter((node) => node?.type === 'awsService' && node?.data?.serviceId);
  const nodeIds = new Set(nodes.map((node) => node?.id));

  if (!serviceNodes.length) {
    issues.push({ severity: 'error', message: 'Diagram must contain at least one AWS service node.' });
  }

  if (hasValue(region) && !isValidAwsRegion(region)) {
    issues.push({ severity: 'error', message: `"${region}" is not a valid AWS region (expected a shape like "us-east-1" or "ap-south-1").` });
  }

  for (const node of serviceNodes) {
    const serviceId = node.data.serviceId;
    for (const key of requiredKeysForNode(node, serviceNodes, edges)) {
      if (!hasValue(node.data?.config?.[key]) && !isResolvableViaConnection(node, serviceNodes, edges, key) && !isResolvableViaNewRole(node, key)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `${node.data?.label ?? node.data?.serviceName ?? serviceId} is missing required field "${key}".`,
        });
      }
    }

    for (const [key, value] of Object.entries(node.data?.config ?? {})) {
      if (isPlaceholderValue(value)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `${node.data?.label ?? node.data?.serviceName ?? serviceId} has placeholder value for "${key}". Replace it with a real AWS value before deployment.`,
        });
      }

      if (key.endsWith('_arn') && hasValue(value) && !looksLikeTerraformExpression(value) && !isValidArn(value)) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `${node.data?.label ?? node.data?.serviceName ?? serviceId} field "${key}" doesn't look like a valid ARN (expected a shape like "arn:aws:service:region:account-id:resource").`,
        });
      }
    }

    if (serviceId === 'rds') {
      const hasPrivateSubnet = nodes.some((candidate) => candidate?.data?.groupKind === 'Private Subnet');
      if (!hasPrivateSubnet) {
        issues.push({
          severity: 'warning',
          nodeId: node.id,
          message: 'RDS should be placed in a private subnet boundary.',
        });
      }
    }

    if (serviceId === 's3' && !serviceIds.has('kms') && !hasValue(node.data?.config?.website_index_document) && node.data?.config?.public_read !== 'true') {
      issues.push({
        severity: 'warning',
        nodeId: node.id,
        message: 'Consider adding KMS encryption for S3.',
      });
    }
  }

  for (const edge of edges) {
    if (!edge.source || !edge.target) {
      issues.push({ severity: 'error', edgeId: edge.id, message: 'Connection is missing source or target.' });
    } else if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({ severity: 'error', edgeId: edge.id, message: 'Connection references a node that no longer exists in the diagram.' });
    }
  }

  return issues;
}

// Identifier fields such as name/function_name/alarm_name/identifier are intentionally left off these lists
// for service types whose Terraform generator auto-fills a per-deployment unique name when the field is left
// blank (apigw, alb, beanstalk, cloudwatch, codebuild, codepipeline, cognito, docdb, docdb-instance,
// docdb-subnet-group, dynamodb, ecr, ecs, eks, elasticache, eventbridge, iam, kinesis, lambda, lb-target-group,
// rds, redshift, secrets, sns, sqs, waf). Templates and users can still set them explicitly, but a blank value
// no longer blocks deployment, and using the auto-generated name avoids AWS "duplicate resource name" errors
// when the same diagram is deployed twice.
//
// Fields listed in edgeResolvableFieldsByServiceId below are also left required here, but are treated as
// satisfied when the node has a connection to the right kind of node (e.g. a subnet connected to a vpc) —
// the generator resolves the actual reference from that connection, matching aws-console-style "just wire
// it up" diagram building instead of requiring literal Terraform expressions typed into the form.
const requiredByServiceId = {
  ec2: ['ami', 'instance_type'],
  lambda: ['role_arn', 'filename', 'handler', 'runtime'],
  ecs: [],
  eks: ['role_arn', 'subnet_ids'],
  beanstalk: ['application', 'solution_stack_name'],
  vpc: ['cidr_block'],
  subnet: ['vpc_id', 'cidr_block', 'availability_zone'],
  igw: ['vpc_id'],
  'route-table': ['vpc_id'],
  route: ['route_table_id', 'destination_cidr_block', 'gateway_id'],
  'route-association': ['subnet_id', 'route_table_id'],
  'security-group': ['vpc_id'],
  alb: ['subnets'],
  'lb-target-group': ['port', 'protocol', 'vpc_id'],
  'lb-target-attachment': ['target_group_arn', 'target_id', 'port'],
  'lb-listener': ['load_balancer_arn', 'port', 'protocol', 'target_group_arn'],
  apigw: ['protocol_type'],
  cloudfront: ['enabled'],
  route53: ['zone_id', 'name', 'type', 'records'],
  waf: ['scope', 'default_action', 'metric_name'],
  nat: ['subnet_id', 'connectivity_type'],
  s3: ['bucket'],
  efs: ['creation_token'],
  ebs: ['availability_zone', 'size', 'type'],
  rds: ['engine', 'instance_class', 'allocated_storage', 'username', 'password', 'skip_final_snapshot'],
  'docdb-subnet-group': ['subnet_ids'],
  docdb: ['engine', 'master_username', 'master_password'],
  'docdb-instance': ['cluster_identifier', 'instance_class', 'engine'],
  dynamodb: ['billing_mode', 'hash_key', 'hash_key_type'],
  elasticache: ['engine', 'node_type', 'num_cache_nodes', 'port'],
  redshift: ['node_type', 'master_username', 'master_password', 'database_name'],
  sqs: ['fifo_queue'],
  sns: [],
  eventbridge: [],
  kinesis: ['shard_count'],
  iam: ['assume_role_policy'],
  secrets: [],
  kms: ['description', 'key_usage'],
  cognito: [],
  codepipeline: ['role_arn'],
  codebuild: ['service_role', 'compute_type', 'image', 'type'],
  ecr: [],
  cloudwatch: ['comparison_operator', 'evaluation_periods', 'metric_name', 'namespace', 'period', 'statistic', 'threshold'],
  xray: ['group_name', 'filter_expression'],
};

// field -> serviceId of a connected node whose presence satisfies that field, per node type.
const edgeResolvableFieldsByServiceId = {
  subnet: { vpc_id: 'vpc' },
  igw: { vpc_id: 'vpc' },
  'route-table': { vpc_id: 'vpc' },
  route: { route_table_id: 'route-table', gateway_id: 'igw' },
  'route-association': { subnet_id: 'subnet', route_table_id: 'route-table' },
  'security-group': { vpc_id: 'vpc' },
  alb: { subnets: 'subnet' },
  'lb-target-group': { vpc_id: 'vpc' },
  'lb-listener': { load_balancer_arn: 'alb', target_group_arn: 'lb-target-group' },
  'docdb-subnet-group': { subnet_ids: 'subnet' },
  'docdb-instance': { cluster_identifier: 'docdb' },
  lambda: { role_arn: 'iam' },
  iam: { assume_role_policy: 'lambda' },
};

function requiredKeysForNode(node, nodes = [], edges = []) {
  const keys = [...(requiredByServiceId[node.data?.serviceId] ?? [])];
  const config = node.data?.config ?? {};

  if (node.data?.serviceId === 'nat' && config.connectivity_type === 'public') keys.push('allocation_id');
  if (node.data?.serviceId === 'dynamodb' && config.billing_mode === 'PROVISIONED') keys.push('read_capacity', 'write_capacity');
  if (node.data?.serviceId === 'eventbridge' && !hasValue(config.schedule_expression)) keys.push('event_pattern');
  if (node.data?.serviceId === 's3' && hasValue(config.bucket_prefix)) {
    return keys.filter((key) => key !== 'bucket');
  }
  if (node.data?.serviceId === 'route53' && hasCloudFrontAlias(node, nodes, edges) && ['A', 'AAAA'].includes(String(config.type || 'A'))) {
    return keys.filter((key) => key !== 'records');
  }

  return Array.from(new Set(keys));
}

// An iam-role field (e.g. lambda's role_arn) can also be satisfied by the PropertiesPanel's
// "Create new role" mode, which generates a fresh aws_iam_role in the Terraform plan instead of
// pointing at an existing ARN — see IamRolePickerModal / lambdaExecutionRoleFromField.
function isResolvableViaNewRole(node, key) {
  const config = node.data?.config ?? {};
  const source = config[`${key}_source`];
  if (source === 'new_json') return hasValue(config[`${key}_new_name`]);
  if (source === 'new_terraform') return hasValue(config[`${key}_new_terraform`]) && hasValue(config[`${key}_new_terraform_ref`]);
  return false;
}

function isResolvableViaConnection(node, nodes, edges, key) {
  const requiredServiceId = edgeResolvableFieldsByServiceId[node.data?.serviceId]?.[key];
  if (!requiredServiceId) return false;

  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  return edges.some((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return false;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    return nodeById[otherId]?.data?.serviceId === requiredServiceId;
  });
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// Shape check only — deliberately not an exhaustive region/partition enum, since AWS adds regions
// over time and a stale hardcoded list would start rejecting real ones. Matches us-east-1,
// ap-south-1, us-gov-west-1, cn-north-1, etc.
function isValidAwsRegion(value) {
  return /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(String(value).trim());
}

function isValidArn(value) {
  return /^arn:(aws|aws-cn|aws-us-gov):[a-zA-Z0-9-]+:[a-z0-9-]*:\d{0,12}:.+$/.test(String(value).trim());
}

// A field resolved from a diagram connection (or a raw Terraform reference someone typed directly)
// is a Terraform expression, not a literal value — ARN-shape checking only makes sense against a
// literal string the user actually typed. Mirrors terraformGenerator.js's own
// looksLikeTerraformExpression so "what the generator will treat as an expression" and "what this
// validator skips" stay in sync.
function looksLikeTerraformExpression(value) {
  const trimmed = String(value).trim();
  return /^\${.+}$/.test(trimmed) || /^(data\.|aws_|var\.|local\.|module\.)/.test(trimmed);
}

function hasCloudFrontAlias(node, nodes, edges) {
  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  return edges.some((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return false;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    return nodeById[otherId]?.data?.serviceId === 'cloudfront';
  });
}

function isPlaceholderValue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes('example.com') ||
    text.includes('replace-with-') ||
    text.includes('placeholder') ||
    /^z[0-9a-z]*example$/i.test(String(value).trim())
  );
}
