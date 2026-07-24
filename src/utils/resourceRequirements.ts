import { serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode } from '../types';
import type { ValidationIssue } from './validate';

type ConditionalRequirement = {
  key: string;
  when: (config: Record<string, string | number>) => boolean;
  reason: string;
};

type ServiceRequirement = {
  required: string[];
  recommended?: string[];
  sensitive?: string[];
  conditional?: ConditionalRequirement[];
  outputs?: string[];
  connectivity?: string[];
};

export type ResourceRequirementReport = {
  nodeId: string;
  label: string;
  serviceId: string;
  serviceName: string;
  terraformType: string;
  validKeys: Array<{ key: string; label: string; required: boolean; value: string | number | '' }>;
  missingRequiredKeys: string[];
  recommendedKeys: string[];
  sensitiveKeys: string[];
  expectedOutputs: string[];
  connectivity: string[];
  arn: string;
};

const serviceRequirements: Record<string, ServiceRequirement> = {
  ec2: {
    required: ['ami', 'instance_type'],
    recommended: ['subnet_id', 'vpc_security_group_ids', 'associate_public_ip_address', 'iam_role_arn', 'iam_instance_profile'],
    outputs: ['id', 'arn', 'public_ip', 'private_ip', 'public_dns', 'private_dns', 'availability_zone', 'key_pair_name', 'ssh_private_key_pem'],
    connectivity: [
      'Leave key_name blank to let infraflow create an AWS key pair and return the generated private .pem in the deployment output bundle.',
      'Set key_name only when you already own the matching local .pem/.ppk file.',
      'For Windows/PuTTY, convert the downloaded .pem to .ppk with PuTTYgen before connecting.',
    ],
  },
  lambda: {
    required: ['role_arn', 'filename', 'handler', 'runtime'],
    recommended: ['function_name', 'source_code_hash', 'memory_size', 'timeout'],
    outputs: ['arn', 'invoke_arn', 'function_name', 'qualified_arn', 'version'],
    connectivity: [
      'Grant callers lambda:InvokeFunction and connect API Gateway/EventBridge/SQS triggers where required.',
      'Leave function_name blank to let infraflow generate a unique name per deployment; a fixed name collides if this diagram is deployed more than once.',
    ],
  },
  ecs: { required: [], recommended: ['name', 'cluster', 'desired_count', 'launch_type'], outputs: ['id', 'name', 'cluster'] },
  eks: { required: ['role_arn', 'subnet_ids'], recommended: ['name'], outputs: ['arn', 'endpoint', 'certificate_authority', 'identity'] },
  beanstalk: { required: ['application', 'solution_stack_name'], recommended: ['name'], outputs: ['id', 'name', 'endpoint_url', 'cname'] },
  vpc: { required: ['cidr_block'], recommended: ['enable_dns_hostnames', 'enable_dns_support'], outputs: ['id', 'arn', 'cidr_block', 'default_security_group_id'] },
  subnet: { required: ['vpc_id', 'cidr_block', 'availability_zone'], recommended: ['map_public_ip_on_launch'], outputs: ['id', 'arn', 'cidr_block', 'availability_zone'] },
  igw: { required: ['vpc_id'], outputs: ['id', 'arn', 'owner_id'] },
  'route-table': { required: ['vpc_id'], outputs: ['id', 'arn', 'owner_id'] },
  route: { required: ['route_table_id', 'destination_cidr_block', 'gateway_id'], outputs: ['id'] },
  'route-association': { required: ['subnet_id', 'route_table_id'], outputs: ['id'] },
  'security-group': {
    required: ['vpc_id'],
    recommended: ['name', 'ingress_ports', 'ingress_cidr_blocks', 'egress_cidr_blocks'],
    outputs: ['id', 'arn', 'name', 'owner_id'],
    connectivity: ['Confirm inbound CIDR blocks are least-privilege before deployment.'],
  },
  alb: { required: ['subnets'], recommended: ['name', 'load_balancer_type', 'internal', 'security_groups'], outputs: ['arn', 'dns_name', 'zone_id'] },
  'lb-target-group': { required: ['port', 'protocol', 'vpc_id'], recommended: ['name'], outputs: ['arn', 'name'] },
  'lb-target-attachment': { required: ['target_group_arn', 'target_id', 'port'], outputs: ['id'] },
  'lb-listener': { required: ['load_balancer_arn', 'port', 'protocol', 'target_group_arn'], outputs: ['arn', 'id'] },
  apigw: { required: ['protocol_type'], recommended: ['name'], outputs: ['id', 'api_endpoint', 'execution_arn'] },
  cloudfront: { required: ['enabled'], recommended: ['comment', 'default_root_object', 'price_class'], outputs: ['id', 'arn', 'domain_name', 'hosted_zone_id'] },
  route53: { required: ['zone_id', 'name', 'type', 'records'], recommended: ['ttl'], outputs: ['fqdn', 'name'] },
  waf: {
    required: ['scope', 'default_action', 'metric_name'],
    recommended: ['name'],
    outputs: ['arn', 'id', 'capacity'],
    connectivity: ['Leave name blank to let infraflow generate a unique WebACL name per deployment; a fixed name collides if this diagram is deployed more than once.'],
  },
  nat: {
    required: ['subnet_id', 'connectivity_type'],
    conditional: [{ key: 'allocation_id', when: (config) => String(config.connectivity_type) === 'public', reason: 'Public NAT gateways require an Elastic IP allocation ID.' }],
    outputs: ['id', 'public_ip', 'private_ip', 'network_interface_id'],
  },
  s3: {
    required: ['bucket'],
    recommended: ['bucket_prefix', 'website_index_document', 'website_error_document', 'public_read', 'versioning'],
    outputs: ['id', 'arn', 'bucket_domain_name', 'bucket_regional_domain_name'],
    connectivity: ['For the lowest-cost React deployment, use bucket_prefix plus website_index_document=index.html and public_read=true.'],
  },
  efs: { required: ['creation_token'], recommended: ['encrypted', 'performance_mode', 'throughput_mode'], outputs: ['id', 'arn', 'dns_name'] },
  ebs: { required: ['availability_zone', 'size', 'type'], recommended: ['encrypted'], outputs: ['id', 'arn', 'availability_zone'] },
  rds: {
    required: ['engine', 'instance_class', 'allocated_storage', 'username', 'password', 'skip_final_snapshot'],
    recommended: ['identifier'],
    sensitive: ['password'],
    outputs: ['arn', 'address', 'endpoint', 'port', 'resource_id'],
    connectivity: [
      'Store database passwords in Secrets Manager or SSM SecureString instead of a plain node value.',
      'Leave identifier blank to let infraflow generate a unique DB identifier per deployment; a fixed identifier collides if this diagram is deployed more than once.',
    ],
  },
  'docdb-subnet-group': { required: ['subnet_ids'], recommended: ['name'], outputs: ['arn', 'name'] },
  docdb: {
    required: ['engine', 'master_username', 'master_password'],
    recommended: ['cluster_identifier', 'db_subnet_group_name', 'vpc_security_group_ids'],
    sensitive: ['master_password'],
    outputs: ['arn', 'endpoint', 'reader_endpoint', 'port'],
  },
  'docdb-instance': { required: ['cluster_identifier', 'instance_class', 'engine'], recommended: ['identifier'], outputs: ['arn', 'endpoint', 'identifier'] },
  dynamodb: {
    required: ['billing_mode', 'hash_key', 'hash_key_type'],
    recommended: ['name'],
    conditional: [
      { key: 'read_capacity', when: (config) => String(config.billing_mode) === 'PROVISIONED', reason: 'Provisioned DynamoDB tables require read capacity.' },
      { key: 'write_capacity', when: (config) => String(config.billing_mode) === 'PROVISIONED', reason: 'Provisioned DynamoDB tables require write capacity.' },
    ],
    outputs: ['arn', 'id', 'stream_arn'],
  },
  elasticache: { required: ['engine', 'node_type', 'num_cache_nodes', 'port'], recommended: ['cluster_id'], outputs: ['arn', 'cache_nodes', 'cluster_address'] },
  redshift: {
    required: ['node_type', 'master_username', 'master_password', 'database_name'],
    recommended: ['cluster_identifier'],
    sensitive: ['master_password'],
    outputs: ['arn', 'endpoint', 'dns_name'],
  },
  sqs: { required: ['fifo_queue'], recommended: ['name', 'visibility_timeout_seconds', 'message_retention_seconds'], outputs: ['arn', 'id', 'url'] },
  sns: { required: [], recommended: ['name', 'display_name'], outputs: ['arn', 'id'] },
  eventbridge: {
    required: [],
    recommended: ['name'],
    conditional: [{ key: 'event_pattern', when: (config) => !String(config.schedule_expression ?? '').trim(), reason: 'EventBridge needs either an event pattern or a schedule expression.' }],
    outputs: ['arn', 'name'],
  },
  kinesis: { required: ['shard_count'], recommended: ['name', 'retention_period'], outputs: ['arn', 'name', 'stream_mode_details'] },
  iam: { required: ['assume_role_policy'], recommended: ['name'], outputs: ['arn', 'name', 'unique_id'] },
  secrets: { required: [], recommended: ['name', 'description', 'recovery_window_in_days'], outputs: ['arn', 'id', 'name'] },
  kms: { required: ['description', 'key_usage'], recommended: ['deletion_window_in_days', 'enable_key_rotation'], outputs: ['arn', 'key_id'] },
  cognito: { required: [], recommended: ['name', 'mfa_configuration'], outputs: ['arn', 'id', 'endpoint'] },
  codepipeline: { required: ['role_arn'], recommended: ['name', 'pipeline_type'], outputs: ['arn', 'id'] },
  codebuild: { required: ['service_role', 'compute_type', 'image', 'type'], recommended: ['name'], outputs: ['arn', 'id', 'badge_url'] },
  ecr: { required: [], recommended: ['name', 'image_tag_mutability', 'scan_on_push'], outputs: ['arn', 'repository_url', 'registry_id'] },
  cloudwatch: {
    required: ['comparison_operator', 'evaluation_periods', 'metric_name', 'namespace', 'period', 'statistic', 'threshold'],
    recommended: ['alarm_name'],
    outputs: ['arn', 'id'],
  },
  xray: { required: ['group_name', 'filter_expression'], outputs: ['arn', 'group_name'] },
};

export function getServiceRequirement(serviceId?: string): ServiceRequirement {
  return serviceId ? serviceRequirements[serviceId] ?? { required: [] } : { required: [] };
}

export function expectedOutputsForService(serviceId?: string) {
  return getServiceRequirement(serviceId).outputs ?? ['id', 'arn'];
}

export function validateResourceRequirements(nodes: AwsNode[], edges: AwsEdge[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const serviceNodes = nodes.filter((node) => node.type === 'awsService' && node.data.serviceId);

  if (!serviceNodes.length) {
    issues.push({ severity: 'error', message: 'Diagram must contain at least one deployable AWS service node.' });
  }

  for (const node of serviceNodes) {
    const report = getResourceRequirementReport(node, nodes, edges);
    for (const key of report.missingRequiredKeys) {
      issues.push({
        nodeId: node.id,
        severity: 'error',
        message: `${node.data.label || node.data.serviceName} is missing required field "${fieldLabel(node.data.serviceId, key)}".`,
      });
    }

    for (const [key, value] of Object.entries(node.data.config ?? {})) {
      if (isPlaceholderValue(value)) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `${node.data.label || node.data.serviceName} has placeholder value for "${fieldLabel(node.data.serviceId, key)}". Replace it with a real AWS value before deployment.`,
        });
      }
    }

    const sensitiveKeysWithRawValues = report.sensitiveKeys.filter((key) => hasValue(node.data.config?.[key]));
    for (const key of sensitiveKeysWithRawValues) {
      const hasBinding = (node.data.bindings ?? []).some((binding) => binding.targetPath === key && binding.sensitive && binding.source.kind !== 'local');
      if (!hasBinding) {
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          message: `${node.data.label || node.data.serviceName} uses sensitive field "${fieldLabel(node.data.serviceId, key)}"; prefer Secrets Manager, SSM SecureString, or a sensitive variable binding.`,
        });
      }
    }
  }

  return issues;
}

export function getResourceRequirementReport(node: AwsNode, nodes: AwsNode[] = [], edges: AwsEdge[] = []): ResourceRequirementReport {
  const service = serviceById[node.data.serviceId ?? ''];
  const requirement = getServiceRequirement(node.data.serviceId);
  const required = new Set([...requiredKeysForNode(node, requirement, nodes, edges), ...conditionalRequiredKeys(node, requirement)]);
  const missingRequiredKeys = Array.from(required).filter(
    (key) => !hasValue(node.data.config?.[key]) && !isResolvableViaConnection(node, nodes, edges, key),
  );
  const fields = service?.fields ?? [];

  return {
    nodeId: node.id,
    label: node.data.label || node.data.serviceName,
    serviceId: node.data.serviceId ?? 'unknown',
    serviceName: node.data.serviceName,
    terraformType: service?.terraformType ?? 'unsupported',
    validKeys: fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: required.has(field.key) && !isResolvableViaConnection(node, nodes, edges, field.key),
      value: node.data.config?.[field.key] ?? '',
    })),
    missingRequiredKeys,
    recommendedKeys: requirement.recommended ?? [],
    sensitiveKeys: requirement.sensitive ?? [],
    expectedOutputs: expectedOutputsForNode(node),
    connectivity: requirement.connectivity ?? defaultConnectivityNotes(node),
    arn: node.data.arn,
  };
}

export function buildDeploymentResourceBundle(nodes: AwsNode[], edges: AwsEdge[], validationIssues: ValidationIssue[], outputs?: Record<string, unknown>) {
  const resources = nodes.filter((node) => node.type === 'awsService' && node.data.serviceId).map((node) => getResourceRequirementReport(node, nodes, edges));

  return {
    generatedAt: new Date().toISOString(),
    purpose: 'One-time deployment resource information for connectivity, handoff, and troubleshooting.',
    warning:
      'This file can contain infrastructure names, ARNs, endpoints, key-pair names, and generated private keys. Store it securely and download generated EC2 keys only once.',
    summary: {
      resources: resources.length,
      connections: edges.length,
      errors: validationIssues.filter((issue) => issue.severity === 'error').length,
      warnings: validationIssues.filter((issue) => issue.severity === 'warning').length,
    },
    resources,
    connections: edges.map((edge) => ({
      id: edge.id,
      source: nodeLabel(nodes, edge.source),
      target: nodeLabel(nodes, edge.target),
      type: edge.data?.connectionType ?? 'data',
      protocol: edge.data?.protocol,
      port: edge.data?.port,
    })),
    validationIssues,
    terraformOutputs: outputs ?? {},
  };
}

export function downloadJsonFile(fileName: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function expectedOutputsForNode(node: AwsNode) {
  const outputs = expectedOutputsForService(node.data.serviceId);
  if (node.data.serviceId === 's3' && hasValue(node.data.config?.website_index_document)) {
    return [...outputs, 'website_endpoint', 'website_domain'];
  }
  return outputs;
}

function conditionalRequiredKeys(node: AwsNode, requirement: ServiceRequirement) {
  const config = node.data.config ?? {};
  return (requirement.conditional ?? []).filter((item) => item.when(config)).map((item) => item.key);
}

function requiredKeysForNode(node: AwsNode, requirement: ServiceRequirement, nodes: AwsNode[], edges: AwsEdge[]) {
  const required = requirement.required;
  const config = node.data.config ?? {};
  if (node.data.serviceId === 'route53' && hasCloudFrontAlias(node, nodes, edges) && ['A', 'AAAA'].includes(String(config.type || 'A'))) {
    return required.filter((key) => key !== 'records');
  }
  if (node.data.serviceId === 's3' && hasValue(config.bucket_prefix)) {
    return required.filter((key) => key !== 'bucket');
  }
  return required;
}

function fieldLabel(serviceId: string | undefined, key: string) {
  return serviceById[serviceId ?? '']?.fields.find((field) => field.key === key)?.label ?? key;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// field -> serviceId of a connected node whose presence satisfies that field. Mirrors the backend
// Terraform generator's connection-based auto-resolution (e.g. a subnet connected to a vpc node
// gets its vpc_id filled in automatically), so the diagram builder's validation doesn't block
// deployment on fields the generator will actually resolve from the drawn connections.
const edgeResolvableFieldsByServiceId: Record<string, Record<string, string>> = {
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

function isResolvableViaConnection(node: AwsNode, nodes: AwsNode[], edges: AwsEdge[], key: string) {
  const requiredServiceId = edgeResolvableFieldsByServiceId[node.data.serviceId ?? '']?.[key];
  if (!requiredServiceId) return false;

  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  return edges.some((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return false;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    return nodeById[otherId]?.data.serviceId === requiredServiceId;
  });
}

function hasCloudFrontAlias(node: AwsNode, nodes: AwsNode[], edges: AwsEdge[]) {
  const nodeById = Object.fromEntries(nodes.map((candidate) => [candidate.id, candidate]));
  return edges.some((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return false;
    const otherId = edge.source === node.id ? edge.target : edge.source;
    return nodeById[otherId]?.data.serviceId === 'cloudfront';
  });
}

function isPlaceholderValue(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  return text.includes('example.com') || text.includes('replace-with-') || text.includes('placeholder') || /^z[0-9a-z]*example$/i.test(String(value).trim());
}

function defaultConnectivityNotes(node: AwsNode) {
  return [`Use Terraform outputs for ${node.data.serviceName} id, ARN, endpoint, or URL values after apply completes.`];
}

function nodeLabel(nodes: AwsNode[], id: string) {
  return nodes.find((node) => node.id === id)?.data.label ?? id;
}
