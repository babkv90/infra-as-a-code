import { MarkerType } from 'reactflow';
import { awsServices, serviceById } from '../data/awsServices';
import type { AwsEdge, AwsNode, DiagramSnapshot, EdgeConnectionType, GroupKind, NodeBinding, NodeBindingSourceKind, NodeBindingTargetKind } from '../types';

type UnknownRecord = Record<string, unknown>;

const terraformTypeToServiceId = Object.fromEntries(awsServices.map((service) => [service.terraformType, service.id])) as Record<string, string>;
const sensitiveNamePattern = /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential)/i;

export type TerraformSourceFile = {
  name: string;
  content: string;
};

const resourceTypeAliases: Record<string, string> = {
  aws_apigatewayv2_api: 'apigw',
  aws_cloudwatch_log_group: 'cloudwatch',
  aws_s3_bucket_versioning: 's3',
  aws_s3_bucket_public_access_block: 's3',
  aws_cloudwatch_event_rule: 'eventbridge',
  aws_db_subnet_group: 'docdb-subnet-group',
  'AWS::EC2::Instance': 'ec2',
  'AWS::Lambda::Function': 'lambda',
  'AWS::S3::Bucket': 's3',
  'AWS::RDS::DBInstance': 'rds',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::SQS::Queue': 'sqs',
  'AWS::SNS::Topic': 'sns',
  'AWS::EC2::VPC': 'vpc',
  'AWS::EC2::Subnet': 'subnet',
  'AWS::EC2::InternetGateway': 'igw',
  'AWS::EC2::RouteTable': 'route-table',
  'AWS::EC2::RouteTableAssociation': 'route-association',
  'AWS::EC2::SecurityGroup': 'security-group',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'alb',
  'AWS::ElasticLoadBalancingV2::TargetGroup': 'lb-target-group',
  'AWS::ElasticLoadBalancingV2::Listener': 'lb-listener',
};

export function normalizeImportedDiagram(input: unknown): DiagramSnapshot {
  if (isRecord(input) && Array.isArray(input.nodes)) {
    return normalizeAppSnapshot(input);
  }

  if (isRecord(input) && isRecord(input.resource)) {
    return fromTerraformJson(input);
  }

  const awsNodes = fromAwsResourceJson(input);
  if (awsNodes.length) return { nodes: awsNodes, edges: [] };

  throw new Error('No supported diagram resources were found in this JSON file.');
}

export function normalizeTerraformFiles(files: TerraformSourceFile[]): DiagramSnapshot {
  const classifiedFiles = files.map((file) => ({ ...file, kind: terraformFileKind(file.name) }));
  const moduleFiles = classifiedFiles.filter((file) => file.kind === 'tf' || file.kind === 'hcl');
  const secretMetadata = scanSecretMetadataFiles(classifiedFiles.filter((file) => file.kind !== 'tf' && file.kind !== 'hcl'));
  const input = moduleFiles.map(({ name, content }) => `\n# Source: ${name}\n${content}`).join('\n');
  const blocks = parseTerraformBlocks(input);
  const providerRegion = providerRegionFromBlocks(blocks) ?? 'ap-south-1';
  const nodes: AwsNode[] = [];
  const resourceAddressToNodeId = new Map<string, string>();
  const resourceBodies = new Map<string, string>();

  for (const block of blocks) {
    if (block.kind !== 'resource' || !block.type || !block.name) continue;
    const serviceId = serviceIdFromResourceType(block.type);
    if (!serviceId || shouldHideTerraformNode(serviceId)) continue;

    const rawConfig = normalizeHclConfig(block.body);
    const { config, warnings } = sanitizeSensitiveConfig(rawConfig, block.body);
    const node = createServiceNode({
      serviceId,
      label: labelFromHclResource(block.name, config),
      config,
      region: stringValue(config.region) || providerRegion,
      resourceAddress: `${block.type}.${block.name}`,
      index: nodes.length,
    });
    if (warnings.length) node.data.warning = warnings.join(' ');

    nodes.push(node);
    resourceAddressToNodeId.set(`${block.type}.${block.name}`, node.id);
    resourceBodies.set(`${block.type}.${block.name}`, block.body);
  }

  if (!nodes.length) {
    throw new Error('This Terraform file does not contain supported AWS resource blocks.');
  }

  applyInferredBindings(nodes, resourceAddressToNodeId, resourceBodies, secretMetadata);
  const edges = inferHclEdges(resourceAddressToNodeId, resourceBodies, nodes);
  return { nodes: applyEnterpriseLayout(nodes, edges), edges };
}

type TerraformFileKind = 'tf' | 'hcl' | 'tfvars' | 'env' | 'json' | 'yaml' | 'other';

type SecretMetadata = {
  variableNames: Set<string>;
  sensitiveNames: Set<string>;
};

function terraformFileKind(name: string): TerraformFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tf')) return 'tf';
  if (lower.endsWith('.hcl')) return 'hcl';
  if (lower.endsWith('.tfvars') || lower.endsWith('.tfvars.json') || lower.endsWith('.auto.tfvars')) return 'tfvars';
  if (lower.endsWith('.env')) return 'env';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'other';
}

function scanSecretMetadataFiles(files: Array<TerraformSourceFile & { kind: TerraformFileKind }>): SecretMetadata {
  const variableNames = new Set<string>();
  const sensitiveNames = new Set<string>();

  for (const file of files) {
    for (const key of scanConfigKeys(file.content, file.kind)) {
      variableNames.add(key);
      variableNames.add(toTerraformVariableName(key));
      if (sensitiveNamePattern.test(key)) {
        sensitiveNames.add(key);
        sensitiveNames.add(toTerraformVariableName(key));
      }
    }
  }

  return { variableNames, sensitiveNames };
}

function scanConfigKeys(content: string, kind: TerraformFileKind): string[] {
  if (kind === 'json') return scanJsonKeys(content);

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]/)?.[1])
    .filter((key): key is string => Boolean(key));
}

function scanJsonKeys(content: string): string[] {
  try {
    const parsed = JSON.parse(content);
    const keys: string[] = [];
    collectJsonKeys(parsed, keys);
    return keys;
  } catch {
    return scanConfigKeys(content, 'other');
  }
}

function collectJsonKeys(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonKeys(item, keys));
    return;
  }

  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectJsonKeys(child, keys);
  }
}

function toTerraformVariableName(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
}

function sanitizeSensitiveConfig(config: Record<string, string | number>, body: string): { config: Record<string, string | number>; warnings: string[] } {
  const sanitized = { ...config };
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    const valueText = String(value);
    if (!sensitiveNamePattern.test(key) && !sensitiveNamePattern.test(valueText)) continue;
    if (looksLikeReference(valueText)) continue;

    sanitized[key] = `var.${toTerraformVariableName(key)}`;
    warnings.push(`Sensitive-looking ${key} was converted to a variable reference; raw upload value was not stored.`);
  }

  if (/\b(secret_string|private_key|access_key|secret_key)\s*=\s*"[^"]+"/i.test(body)) {
    warnings.push('Hardcoded sensitive Terraform value detected; store it in Secrets Manager, SSM SecureString, or a sensitive variable.');
  }

  return { config: sanitized, warnings };
}

function looksLikeReference(value: string): boolean {
  return /^(var\.|local\.|data\.|aws_|module\.|\$\{)/.test(value.trim());
}

function applyInferredBindings(
  nodes: AwsNode[],
  resourceAddressToNodeId: Map<string, string>,
  resourceBodies: Map<string, string>,
  secretMetadata: SecretMetadata,
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();

  for (const [targetAddress, body] of resourceBodies.entries()) {
    const targetNode = nodeById.get(resourceAddressToNodeId.get(targetAddress) ?? '');
    if (!targetNode) continue;

    for (const [sourceAddress, sourceNodeId] of resourceAddressToNodeId.entries()) {
      if (sourceAddress === targetAddress || !referencesTerraformAddress(body, sourceAddress)) continue;
      const sourceNode = nodeById.get(sourceNodeId);
      if (!sourceNode || sourceNode.data.serviceId !== 'secrets') continue;

      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, sourceAddress, sourceNode.data.label),
        targetKind: 'env',
        source: { kind: 'secret', id: sourceNode.id, attribute: inferReferenceAttribute(body, sourceAddress) || 'arn' },
        required: true,
        sensitive: true,
      }, seen);
    }

    for (const variableName of terraformReferences(body, 'var')) {
      const sensitive = secretMetadata.sensitiveNames.has(variableName) || sensitiveNamePattern.test(variableName);
      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, `var.${variableName}`, variableName),
        targetKind: 'env',
        source: { kind: 'variable', id: variableName },
        required: secretMetadata.variableNames.has(variableName),
        sensitive,
      }, seen);
    }

    for (const localName of terraformReferences(body, 'local')) {
      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, `local.${localName}`, localName),
        targetKind: 'env',
        source: { kind: 'local', id: localName },
        required: true,
        sensitive: sensitiveNamePattern.test(localName),
      }, seen);
    }

    for (const ssmAddress of dataSourceReferences(body, 'aws_ssm_parameter')) {
      const ssmName = terraformLogicalNameFromReference(ssmAddress);
      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, ssmAddress, ssmName || 'SSM_PARAMETER'),
        targetKind: 'env',
        source: { kind: 'ssm', id: ssmName || ssmAddress, attribute: inferReferenceAttribute(body, ssmAddress) || 'value' },
        required: true,
        sensitive: sensitiveNamePattern.test(ssmAddress),
      }, seen);
    }

    for (const secretDataAddress of dataSourceReferences(body, 'aws_secretsmanager_secret')) {
      const secretName = terraformLogicalNameFromReference(secretDataAddress);
      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, secretDataAddress, secretName || 'SECRET'),
        targetKind: 'env',
        source: { kind: 'secret', id: secretName || secretDataAddress, attribute: inferReferenceAttribute(body, secretDataAddress) || 'arn' },
        required: true,
        sensitive: true,
      }, seen);
    }

    for (const secretVersionAddress of [
      ...terraformAddressReferences(body, 'aws_secretsmanager_secret_version'),
      ...dataSourceReferences(body, 'aws_secretsmanager_secret_version'),
    ]) {
      addInferredBinding(targetNode, {
        targetPath: inferBindingTargetPath(body, secretVersionAddress, terraformLogicalNameFromReference(secretVersionAddress) || 'SECRET_VALUE'),
        targetKind: 'env',
        source: { kind: 'resourceAttr', id: secretVersionAddress, attribute: inferReferenceAttribute(body, secretVersionAddress) || 'secret_string' },
        required: true,
        sensitive: true,
      }, seen);
    }
  }
}

function addInferredBinding(node: AwsNode, binding: Omit<NodeBinding, 'id'>, seen: Set<string>): void {
  const key = `${node.id}:${binding.targetPath}:${binding.source.kind}:${binding.source.id}:${binding.source.attribute ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  node.data.bindings = [
    ...(node.data.bindings ?? []),
    {
      id: `inferred-${safeId(key)}`,
      ...binding,
    },
  ];
}

function terraformReferences(body: string, root: 'var' | 'local'): string[] {
  const refs = new Set<string>();
  const pattern = new RegExp(`\\b${root}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) refs.add(match[1]);
  return Array.from(refs);
}

function dataSourceReferences(body: string, type: string): string[] {
  const refs = new Set<string>();
  const pattern = new RegExp(`\\bdata\\.${type}\\.[A-Za-z_][A-Za-z0-9_]*`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) refs.add(match[0]);
  return Array.from(refs);
}

function terraformAddressReferences(body: string, type: string): string[] {
  const refs = new Set<string>();
  const pattern = new RegExp(`\\b${type}\\.[A-Za-z_][A-Za-z0-9_]*`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) refs.add(match[0]);
  return Array.from(refs);
}

function terraformLogicalNameFromReference(reference: string): string {
  const parts = reference.split('.');
  return parts[parts.length - 1] || reference;
}

function inferReferenceAttribute(body: string, reference: string): string | undefined {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}\\.([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)*)`));
  return match?.[1];
}

function inferBindingTargetPath(body: string, reference: string, fallback: string): string {
  const index = body.indexOf(reference);
  const windowStart = Math.max(0, index - 700);
  const before = body.slice(windowStart, index < 0 ? body.length : index);
  const after = index < 0 ? '' : body.slice(index, index + 220);
  const context = `${before}${after}`;

  const nameMatches = Array.from(context.matchAll(/\bname\s*=\s*"([^"]+)"/g));
  const nearestName = nameMatches[nameMatches.length - 1]?.[1];
  if (nearestName && /^[A-Za-z_][A-Za-z0-9_]*$/.test(nearestName)) return nearestName;

  const assignment = before.match(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\$\{)?[^=\n]*$/);
  if (assignment?.[1] && !['value', 'valueFrom', 'secret_id', 'secret_string'].includes(assignment[1])) return assignment[1].toUpperCase();

  return toTerraformVariableName(fallback).toUpperCase();
}

function normalizeAppSnapshot(input: UnknownRecord): DiagramSnapshot {
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).filter(isRecord).map((node, index) => normalizeExistingNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(input.edges) ? input.edges : [])
    .filter(isRecord)
    .filter((edge) => typeof edge.source === 'string' && typeof edge.target === 'string' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge, index) => normalizeExistingEdge(edge, index));

  return { nodes, edges };
}

function fromTerraformJson(input: UnknownRecord): DiagramSnapshot {
  const providerRegion = readTerraformProviderRegion(input) ?? 'ap-south-1';
  const references = buildTerraformReferenceMap(input);
  const resourceRoot = input.resource as UnknownRecord;
  const nodes: AwsNode[] = [];

  for (const [terraformType, namedResources] of Object.entries(resourceRoot)) {
    if (!isRecord(namedResources)) continue;
    const serviceId = serviceIdFromResourceType(terraformType);
    if (!serviceId || shouldHideTerraformNode(serviceId)) continue;

    for (const [resourceName, rawConfig] of Object.entries(namedResources)) {
      if (!isRecord(rawConfig)) continue;
      nodes.push(
        createServiceNode({
          serviceId,
          label: labelFromTerraformResource(resourceName, rawConfig),
          config: normalizeTerraformConfig(rawConfig, references),
          arn: stringValue(rawConfig.arn),
          region: providerRegion,
          resourceAddress: `${terraformType}.${resourceName}`,
          index: nodes.length,
        }),
      );
    }
  }

  if (!nodes.length) {
    throw new Error('This Terraform JSON does not contain supported AWS resources.');
  }

  const edges = inferImportedEdges(nodes);
  return { nodes: applyEnterpriseLayout(nodes, edges), edges };
}

function fromAwsResourceJson(input: unknown): AwsNode[] {
  const records: Array<{ serviceId: string; record: UnknownRecord }> = [];

  if (Array.isArray(input)) {
    records.push(...input.filter(isRecord).flatMap(recordToServiceRecords));
  } else if (isRecord(input)) {
    records.push(...extractAwsCliRecords(input));

    const nestedResources = input.resources ?? input.Resources;
    if (Array.isArray(nestedResources)) {
      records.push(...nestedResources.filter(isRecord).flatMap(recordToServiceRecords));
    } else if (isRecord(nestedResources)) {
      records.push(...Object.entries(nestedResources).flatMap(([name, record]) => (isRecord(record) ? recordToServiceRecords({ ...record, name }) : [])));
    }
  }

  return records.map(({ serviceId, record }, index) => {
    const config = configFromAwsRecord(serviceId, record);
    return createServiceNode({
      serviceId,
      label: labelFromAwsRecord(serviceId, record),
      config,
      arn: stringValue(record.arn ?? record.Arn ?? record.FunctionArn ?? record.DBInstanceArn),
      region: stringValue(record.region ?? record.Region ?? config.region),
      status: statusFromAwsRecord(record),
      index,
    });
  });
}

function extractAwsCliRecords(input: UnknownRecord): Array<{ serviceId: string; record: UnknownRecord }> {
  const records: Array<{ serviceId: string; record: UnknownRecord }> = [];

  if (Array.isArray(input.Reservations)) {
    records.push(
      ...input.Reservations.filter(isRecord).flatMap((reservation) =>
        Array.isArray(reservation.Instances) ? reservation.Instances.filter(isRecord).map((record) => ({ serviceId: 'ec2', record })) : [],
      ),
    );
  }

  if (Array.isArray(input.Instances)) records.push(...input.Instances.filter(isRecord).map((record) => ({ serviceId: 'ec2', record })));
  if (Array.isArray(input.Functions)) records.push(...input.Functions.filter(isRecord).map((record) => ({ serviceId: 'lambda', record })));
  if (Array.isArray(input.Buckets)) records.push(...input.Buckets.filter(isRecord).map((record) => ({ serviceId: 's3', record })));
  if (Array.isArray(input.DBInstances)) records.push(...input.DBInstances.filter(isRecord).map((record) => ({ serviceId: 'rds', record })));

  return records;
}

function recordToServiceRecords(record: UnknownRecord): Array<{ serviceId: string; record: UnknownRecord }> {
  const type = stringValue(record.type ?? record.Type ?? record.resourceType ?? record.ResourceType ?? record.resource_type);
  const service = stringValue(record.service ?? record.Service);
  const serviceId = serviceIdFromResourceType(type) ?? serviceIdFromServiceName(service);
  return serviceId ? [{ serviceId, record }] : [];
}

function createServiceNode({
  serviceId,
  label,
  config,
  arn = '',
  region,
  status,
  resourceAddress,
  sourcePath,
  index,
}: {
  serviceId: string;
  label: string;
  config: Record<string, string | number>;
  arn?: string;
  region?: string;
  status?: 'running' | 'stopped' | 'unknown';
  resourceAddress?: string;
  sourcePath?: string;
  index: number;
}): AwsNode {
  const service = serviceById[serviceId];
  const nodeRegion = region || stringValue(config.region) || stringValue(service.defaultConfig.region) || 'ap-south-1';
  const nodeStatus = status ?? statusFromValue(config.status);

  return {
    id: `${serviceId}-import-${Date.now()}-${index}`,
    type: 'awsService',
    position: gridPosition(index),
    data: {
      serviceId,
      serviceName: service.name,
      label: label || service.name,
      region: nodeRegion,
      arn,
      status: nodeStatus,
      color: service.color,
      icon: service.icon,
      subLabel: nodeRegion,
      ports: service.ports,
      config: { ...service.defaultConfig, ...config, region: nodeRegion, status: nodeStatus },
      resourceAddress,
      sourcePath,
    },
  };
}

function normalizeExistingNode(node: UnknownRecord, index: number): AwsNode {
  const data = isRecord(node.data) ? node.data : {};
  const serviceId = stringValue(data.serviceId);
  const service = serviceId ? serviceById[serviceId] : undefined;
  const position = isRecord(node.position) ? node.position : {};
  const region = stringValue(data.region) || stringValue(service?.defaultConfig.region) || 'ap-south-1';
  const status = statusFromValue(data.status);

  return {
    ...node,
    id: stringValue(node.id) || `import-node-${index}`,
    type: stringValue(node.type) || (serviceId ? 'awsService' : 'labelNode'),
    position: {
      x: numberValue(position.x, gridPosition(index).x),
      y: numberValue(position.y, gridPosition(index).y),
    },
    data: {
      serviceId: serviceId || undefined,
      serviceName: stringValue(data.serviceName) || service?.name || 'Imported resource',
      label: stringValue(data.label) || stringValue(data.serviceName) || service?.name || 'Imported resource',
      region,
      arn: stringValue(data.arn),
      status,
      color: stringValue(data.color) || service?.color || '#64748b',
      icon: stringValue(data.icon) || service?.icon || 'Cloud',
      subLabel: stringValue(data.subLabel) || region,
      ports: isRecord(data.ports)
        ? {
            inputs: Array.isArray(data.ports.inputs) ? data.ports.inputs.map(String) : service?.ports.inputs ?? [],
            outputs: Array.isArray(data.ports.outputs) ? data.ports.outputs.map(String) : service?.ports.outputs ?? [],
          }
        : service?.ports ?? { inputs: [], outputs: [] },
      config: isRecord(data.config) ? normalizeConfig(data.config) : { ...(service?.defaultConfig ?? {}), region, status },
      note: stringValue(data.note) || undefined,
      warning: stringValue(data.warning) || undefined,
      resourceAddress: stringValue(data.resourceAddress) || undefined,
      sourcePath: stringValue(data.sourcePath) || undefined,
      resourceCount: numberValue(data.resourceCount, 0) || undefined,
      generated: Boolean(data.generated),
      bindings: normalizeBindings(data.bindings),
    },
  } as AwsNode;
}

function normalizeBindings(value: unknown): NodeBinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const bindings = value
    .map((item, index): NodeBinding | undefined => {
      if (!isRecord(item)) return undefined;
      const source = isRecord(item.source) ? item.source : {};
      const sourceKind = normalizeSourceKind(stringValue(source.kind));
      const targetKind = normalizeTargetKind(stringValue(item.targetKind));
      const targetPath = stringValue(item.targetPath);
      const sourceId = stringValue(source.id);
      if (!targetPath || !sourceId) return undefined;

      return {
        id: stringValue(item.id) || `binding-${index}`,
        targetPath,
        targetKind,
        source: {
          kind: sourceKind,
          id: sourceId,
          attribute: stringValue(source.attribute) || undefined,
        },
        required: Boolean(item.required),
        sensitive: Boolean(item.sensitive),
      };
    })
    .filter((binding): binding is NodeBinding => Boolean(binding));

  return bindings.length ? bindings : undefined;
}

function normalizeTargetKind(value: string): NodeBindingTargetKind {
  return ['env', 'property', 'iam', 'connection'].includes(value) ? (value as NodeBindingTargetKind) : 'env';
}

function normalizeSourceKind(value: string): NodeBindingSourceKind {
  return ['secret', 'ssm', 'variable', 'local', 'resourceAttr', 'output'].includes(value) ? (value as NodeBindingSourceKind) : 'local';
}

function normalizeExistingEdge(edge: UnknownRecord, index: number): AwsEdge {
  const data = isRecord(edge.data) ? edge.data : {};

  return {
    ...edge,
    id: stringValue(edge.id) || `import-edge-${index}`,
    type: stringValue(edge.type) || 'flowEdge',
    source: stringValue(edge.source),
    target: stringValue(edge.target),
    animated: Boolean(edge.animated),
    markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed },
      data: {
        label: stringValue(data.label) || 'data',
        connectionType: ['event', 'security', 'monitoring'].includes(stringValue(data.connectionType)) ? (stringValue(data.connectionType) as EdgeConnectionType) : 'data',
        protocol: stringValue(data.protocol) || 'HTTPS',
        port: stringValue(data.port) || '443',
        hiddenCount: numberValue(data.hiddenCount, 0) || undefined,
        references: Array.isArray(data.references) ? data.references.map(String) : undefined,
      },
  } as AwsEdge;
}

function normalizeTerraformConfig(config: UnknownRecord, references: Map<string, string | number>): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};

  for (const [key, rawValue] of Object.entries(config)) {
    if (key === 'tags') continue;
    const resolved = resolveTerraformValue(rawValue, references);
    if (resolved !== undefined) normalized[key] = resolved;
  }

  return normalized;
}

function normalizeConfig(config: UnknownRecord): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(config)) {
    const normalizedValue = primitiveConfigValue(value);
    if (normalizedValue !== undefined) normalized[key] = normalizedValue;
  }

  return normalized;
}

function configFromAwsRecord(serviceId: string, record: UnknownRecord): Record<string, string | number> {
  switch (serviceId) {
    case 'ec2':
      return normalizeConfig({
        instance_type: record.InstanceType,
        ami: record.ImageId,
        iam_instance_profile: isRecord(record.IamInstanceProfile) ? record.IamInstanceProfile.Arn : undefined,
      });
    case 'lambda':
      return normalizeConfig({ runtime: record.Runtime, memory_size: record.MemorySize ?? record.Memory });
    case 'rds':
      return normalizeConfig({ engine: record.Engine, instance_class: record.DBInstanceClass });
    case 's3':
      return normalizeConfig({ versioning: record.Versioning ?? record.versioning });
    default:
      return normalizeConfig(record);
  }
}

function inferImportedEdges(nodes: AwsNode[]): AwsEdge[] {
  const iamNodes = nodes.filter((node) => node.data.serviceId === 'iam');
  if (!iamNodes.length) return [];

  return nodes
    .filter((node) => node.data.serviceId === 'ec2' || node.data.serviceId === 'lambda')
    .flatMap((node, index) => {
      const source = iamNodes[0];
      if (!source || source.id === node.id) return [];
      return [
        {
          id: `import-edge-${source.id}-${node.id}-${index}`,
          source: source.id,
          target: node.id,
          type: 'flowEdge',
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { label: 'IAM', connectionType: 'security', protocol: 'IAM', port: '' },
        } as AwsEdge,
      ];
    });
}

function shouldHideTerraformNode(serviceId: string): boolean {
  return serviceId === 'route-association' || serviceId === 'lb-target-attachment';
}

export function applyEnterpriseLayout(nodes: AwsNode[], edges: AwsEdge[]): AwsNode[] {
  const serviceNodes = nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode');
  const passthroughNodes = nodes.filter((node) => node.type === 'labelNode' || (node.type === 'groupBox' && !node.data.generated));
  const laidOut = layoutTerraformNodes(serviceNodes, edges);
  return [...buildEnterpriseGroupNodes(laidOut, edges), ...passthroughNodes, ...laidOut];
}

function layoutTerraformNodes(nodes: AwsNode[], edges: AwsEdge[]): AwsNode[] {
  const inboundCount = new Map<string, number>();
  const outboundCount = new Map<string, number>();

  for (const edge of edges) {
    outboundCount.set(edge.source, (outboundCount.get(edge.source) ?? 0) + 1);
    inboundCount.set(edge.target, (inboundCount.get(edge.target) ?? 0) + 1);
  }

  const columns = new Map<number, AwsNode[]>();
  for (const node of nodes) {
    const rank = terraformLayoutRank(node);
    const bucket = columns.get(rank) ?? [];
    bucket.push(node);
    columns.set(rank, bucket);
  }

  const orderedRanks = Array.from(columns.keys()).sort((a, b) => a - b);
  const columnGap = 330;
  const rowGap = 174;
  const startX = 120;
  const startY = 90;

  return orderedRanks.flatMap((rank, columnIndex) => {
    const columnNodes = (columns.get(rank) ?? []).sort((left, right) => {
      const orderDelta = terraformLayoutOrder(left) - terraformLayoutOrder(right);
      if (orderDelta !== 0) return orderDelta;

      const connectivityDelta = (outboundCount.get(right.id) ?? 0) + (inboundCount.get(right.id) ?? 0) - ((outboundCount.get(left.id) ?? 0) + (inboundCount.get(left.id) ?? 0));
      if (connectivityDelta !== 0) return connectivityDelta;

      return left.data.label.localeCompare(right.data.label);
    });

    return columnNodes.map((node, rowIndex) => ({
      ...node,
      position: {
        x: startX + columnIndex * columnGap,
        y: startY + rowIndex * rowGap,
      },
    }));
  });
}

const nodeWidth = 142;
const nodeHeight = 104;

function buildEnterpriseGroupNodes(nodes: AwsNode[], edges: AwsEdge[]): AwsNode[] {
  const groups: AwsNode[] = [];
  const resourceNodes = nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode');
  if (resourceNodes.length < 4) return groups;

  const byId = new Map(resourceNodes.map((node) => [node.id, node]));
  const stackBounds = boundsForNodes(resourceNodes, 96);
  groups.push(createGeneratedGroupNode('generated-stack', 'Terraform stack', `Terraform stack - ${resourceNodes.length} resources`, stackBounds, resourceNodes.length, -40));

  const regionGroups = groupBy(resourceNodes, (node) => node.data.region || stringValue(node.data.config.region) || 'unknown');
  if (regionGroups.size > 1) {
    for (const [region, regionNodes] of regionGroups.entries()) {
      groups.push(
        createGeneratedGroupNode(
          `generated-region-${safeId(region)}`,
          'Region',
          `${region} - ${regionNodes.length} resources`,
          boundsForNodes(regionNodes, 76),
          regionNodes.length,
          -35,
        ),
      );
    }
  }

  const vpcNodes = resourceNodes.filter((node) => node.data.serviceId === 'vpc');
  for (const vpcNode of vpcNodes) {
    const cluster = collectVpcCluster(vpcNode, resourceNodes, edges, byId);
    if (cluster.length < 2) continue;
    groups.push(
      createGeneratedGroupNode(
        `generated-vpc-${vpcNode.id}`,
        'VPC',
        `${vpcNode.data.label} - ${cluster.length} resources`,
        boundsForNodes(cluster, 66),
        cluster.length,
        -30,
      ),
    );
  }

  const subnetNodes = resourceNodes.filter((node) => node.data.serviceId === 'subnet');
  for (const subnetNode of subnetNodes) {
    const cluster = collectSubnetCluster(subnetNode, edges, byId);
    if (cluster.length < 2) continue;
    const kind = subnetGroupKind(subnetNode);
    groups.push(
      createGeneratedGroupNode(
        `generated-subnet-${subnetNode.id}`,
        kind,
        `${subnetNode.data.label} - ${cluster.length} resources`,
        boundsForNodes(cluster, 42),
        cluster.length,
        -20,
      ),
    );
  }

  return groups.sort((left, right) => Number(left.zIndex ?? 0) - Number(right.zIndex ?? 0));
}

function collectVpcCluster(vpcNode: AwsNode, nodes: AwsNode[], edges: AwsEdge[], byId: Map<string, AwsNode>): AwsNode[] {
  const networkableServices = new Set([
    'vpc',
    'igw',
    'nat',
    'subnet',
    'route-table',
    'security-group',
    'alb',
    'lb-listener',
    'lb-target-group',
    'ec2',
    'ecs',
    'eks',
    'lambda',
    'rds',
    'docdb-subnet-group',
    'docdb',
    'docdb-instance',
    'elasticache',
  ]);

  if (nodes.filter((node) => node.data.serviceId === 'vpc').length === 1) {
    return nodes.filter((node) => networkableServices.has(node.data.serviceId ?? ''));
  }

  const selected = new Set([vpcNode.id]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!selected.has(edge.source) && !selected.has(edge.target)) continue;
      const nextId = selected.has(edge.source) ? edge.target : edge.source;
      const next = byId.get(nextId);
      if (!next || selected.has(nextId) || !networkableServices.has(next.data.serviceId ?? '')) continue;
      selected.add(nextId);
      changed = true;
    }
  }

  return Array.from(selected).map((id) => byId.get(id)).filter((node): node is AwsNode => Boolean(node));
}

function collectSubnetCluster(subnetNode: AwsNode, edges: AwsEdge[], byId: Map<string, AwsNode>): AwsNode[] {
  const subnetChildren = new Set(['ec2', 'ecs', 'eks', 'lambda', 'rds', 'docdb', 'docdb-instance', 'elasticache', 'nat', 'alb']);
  const selected = new Map([[subnetNode.id, subnetNode]]);

  for (const edge of edges) {
    if (edge.source !== subnetNode.id && edge.target !== subnetNode.id) continue;
    const other = byId.get(edge.source === subnetNode.id ? edge.target : edge.source);
    if (other && subnetChildren.has(other.data.serviceId ?? '')) selected.set(other.id, other);
  }

  return Array.from(selected.values());
}

function subnetGroupKind(node: AwsNode): GroupKind {
  const label = node.data.label.toLowerCase();
  const publicConfig = stringValue(node.data.config.map_public_ip_on_launch).toLowerCase();
  return label.includes('public') || publicConfig === 'true' ? 'Public Subnet' : 'Private Subnet';
}

function createGeneratedGroupNode(id: string, kind: GroupKind, label: string, bounds: GroupBounds, resourceCount: number, zIndex: number): AwsNode {
  return {
    id,
    type: 'groupBox',
    position: { x: bounds.x, y: bounds.y },
    width: bounds.width,
    height: bounds.height,
    style: { width: bounds.width, height: bounds.height },
    zIndex,
    selectable: true,
    draggable: true,
    data: {
      serviceName: kind,
      label,
      region: '',
      arn: '',
      status: 'unknown',
      color: '#64748b',
      icon: 'BoxSelect',
      subLabel: 'generated boundary',
      ports: { inputs: [], outputs: [] },
      config: { generated_group: 'true', status: 'unknown' },
      groupKind: kind,
      generated: true,
      resourceCount,
    },
  };
}

type GroupBounds = { x: number; y: number; width: number; height: number };

function boundsForNodes(nodes: AwsNode[], padding: number): GroupBounds {
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + Number(node.width ?? nodeWidth)));
  const maxY = Math.max(...nodes.map((node) => node.position.y + Number(node.height ?? nodeHeight)));

  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(280, maxX - minX + padding * 2),
    height: Math.max(190, maxY - minY + padding * 2),
  };
}

function groupBy<T>(items: T[], keyForItem: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function terraformLayoutRank(node: AwsNode): number {
  switch (node.data.serviceId) {
    case 'vpc':
      return 0;
    case 'igw':
    case 'nat':
      return 1;
    case 'subnet':
      return 2;
    case 'route-table':
      return 3;
    case 'security-group':
    case 'iam':
    case 'kms':
    case 'secrets':
    case 'waf':
      return 4;
    case 'alb':
    case 'lb-listener':
    case 'lb-target-group':
    case 'apigw':
    case 'cloudfront':
    case 'route53':
      return 5;
    case 'ec2':
    case 'lambda':
    case 'ecs':
    case 'eks':
    case 'beanstalk':
      return 6;
    case 'docdb-subnet-group':
      return 7;
    case 'rds':
    case 'docdb':
    case 'docdb-instance':
    case 'dynamodb':
    case 'elasticache':
    case 'redshift':
      return 8;
    default:
      return 9;
  }
}

function terraformLayoutOrder(node: AwsNode): number {
  const label = node.data.label.toLowerCase();
  if (node.data.serviceId === 'subnet') {
    if (label.includes('public') || stringValue(node.data.config.map_public_ip_on_launch) === 'true') return 0;
    if (label.includes('private')) return 1;
  }

  const serviceOrder: Record<string, number> = {
    vpc: 0,
    igw: 0,
    nat: 1,
    subnet: 2,
    'route-table': 3,
    'security-group': 4,
    alb: 5,
    'lb-listener': 6,
    'lb-target-group': 7,
    ec2: 8,
    'docdb-subnet-group': 9,
    docdb: 10,
    'docdb-instance': 11,
  };

  return serviceOrder[node.data.serviceId ?? ''] ?? 50;
}

type TerraformBlock = {
  kind: 'resource' | 'data' | 'provider';
  type: string;
  name?: string;
  body: string;
};

function parseTerraformBlocks(input: string): TerraformBlock[] {
  const source = stripTerraformComments(input);
  const blocks: TerraformBlock[] = [];
  const blockPattern = /\b(resource|data|provider)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(source))) {
    const bodyStart = blockPattern.lastIndex;
    const bodyEnd = findMatchingBrace(source, bodyStart - 1);
    if (bodyEnd < 0) continue;

    blocks.push({
      kind: match[1] as TerraformBlock['kind'],
      type: match[2],
      name: match[3],
      body: source.slice(bodyStart, bodyEnd),
    });

    blockPattern.lastIndex = bodyEnd + 1;
  }

  return blocks;
}

function stripTerraformComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const marker = findCommentMarker(line);
      return marker >= 0 ? line.slice(0, marker) : line;
    })
    .join('\n');
}

function findCommentMarker(line: string): number {
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote && char === '#') return index;
    if (!quote && char === '/' && next === '/') return index;
  }

  return -1;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if ((char === '"' || char === "'") && source[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (quote) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function normalizeHclConfig(body: string): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};

  for (const [key, value] of topLevelHclAssignments(body)) {
    if (key === 'tags') {
      const tagName = hclMapValue(value, 'Name');
      if (tagName) normalized.name = tagName;
      continue;
    }

    const primitive = hclPrimitiveValue(value);
    if (primitive !== undefined) normalized[key] = primitive;
  }

  return normalized;
}

function topLevelHclAssignments(body: string): Array<[string, string]> {
  const assignments: Array<[string, string]> = [];
  const lines = body.split('\n');
  let depth = 0;
  let current: { key: string; value: string; startDepth: number } | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const assignment = depth === 0 ? trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/) : undefined;

    if (assignment) {
      if (current) assignments.push([current.key, current.value.trim()]);
      current = { key: assignment[1], value: assignment[2], startDepth: depth };
    } else if (current) {
      current.value += `\n${line}`;
    }

    depth += braceDeltaOutsideStrings(line);

    if (current && depth <= current.startDepth) {
      assignments.push([current.key, current.value.trim()]);
      current = undefined;
    }
  }

  if (current) assignments.push([current.key, current.value.trim()]);
  return assignments;
}

function braceDeltaOutsideStrings(line: string): number {
  let delta = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (quote) continue;
    if (char === '{' || char === '[' || char === '(') delta += 1;
    if (char === '}' || char === ']' || char === ')') delta -= 1;
  }

  return delta;
}

function hclPrimitiveValue(rawValue: string): string | number | undefined {
  const value = rawValue.trim().replace(/,$/, '');
  const quoted = value.match(/^"([\s\S]*)"$/) ?? value.match(/^'([\s\S]*)'$/);
  if (quoted) return quoted[1].replace(/\\"/g, '"');
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value;
  if (/^\[[\s\S]*\]$/.test(value)) return compactHclExpression(value);
  if (!value.includes('\n') && !/^[{\[]/.test(value)) return value;
  return undefined;
}

function compactHclExpression(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function hclMapValue(rawMap: string, key: string): string | undefined {
  const body = rawMap.trim().replace(/^\{/, '').replace(/\}$/, '');
  const pattern = new RegExp(`\\b${key}\\s*=\\s*("([^"]+)"|'([^']+)'|([^\\n,]+))`);
  const match = body.match(pattern);
  return match ? (match[2] ?? match[3] ?? match[4] ?? '').trim() : undefined;
}

function providerRegionFromBlocks(blocks: TerraformBlock[]): string | undefined {
  const provider = blocks.find((block) => block.kind === 'provider' && block.type === 'aws');
  if (!provider) return undefined;
  return stringValue(normalizeHclConfig(provider.body).region) || undefined;
}

function labelFromHclResource(resourceName: string, config: Record<string, string | number>): string {
  return (
    stringValue(
      config.name ??
        config.function_name ??
        config.bucket ??
        config.identifier ??
        config.cluster_identifier ??
        config.cluster_id ??
        config.alarm_name,
    ) || resourceName
  );
}

function inferHclEdges(addressToNodeId: Map<string, string>, resourceBodies: Map<string, string>, nodes: AwsNode[]): AwsEdge[] {
  const edges: AwsEdge[] = [];
  const seen = new Set<string>();

  for (const [targetAddress, body] of resourceBodies.entries()) {
    const target = addressToNodeId.get(targetAddress);
    if (!target) continue;

    for (const [sourceAddress, source] of addressToNodeId.entries()) {
      if (sourceAddress === targetAddress || !referencesTerraformAddress(body, sourceAddress)) continue;
      const key = `${source}-${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `tf-edge-${source}-${target}-${edges.length}`,
        source,
        target,
        type: 'flowEdge',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: edgeDataForTerraformReference(nodes.find((node) => node.id === source), nodes.find((node) => node.id === target)),
      } as AwsEdge);
    }
  }

  return edges;
}

function referencesTerraformAddress(body: string, address: string): boolean {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$\\{)?\\b${escaped}(?:\\.|\\b|[\\],\\s}])`).test(body);
}

function edgeDataForTerraformReference(source?: AwsNode, target?: AwsNode): AwsEdge['data'] {
  const sourceId = source?.data.serviceId;
  const targetId = target?.data.serviceId;

  if (source?.data.serviceId === 'iam') return { label: 'IAM', connectionType: 'security', protocol: 'IAM', port: '' };
  if (source?.data.serviceId === 'eventbridge' || target?.data.serviceId === 'lambda') return { label: 'event', connectionType: 'event', protocol: 'async', port: '' };
  if (sourceId === 'security-group' || targetId === 'security-group') return { label: 'security', connectionType: 'security', protocol: 'SG', port: 'rules' };
  if (sourceId === 'vpc' && targetId === 'subnet') return { label: 'VPC subnet', connectionType: 'data', protocol: 'VPC', port: '' };
  if (sourceId === 'vpc' || targetId === 'vpc' || sourceId === 'subnet' || targetId === 'subnet' || sourceId === 'igw' || targetId === 'igw') {
    return { label: 'network', connectionType: 'data', protocol: 'VPC', port: '' };
  }
  if (sourceId === 'alb' || targetId === 'alb' || sourceId === 'lb-listener' || targetId === 'lb-listener' || sourceId === 'lb-target-group' || targetId === 'lb-target-group') {
    return { label: 'traffic', connectionType: 'data', protocol: 'HTTP', port: '80' };
  }
  if (sourceId === 'docdb' || targetId === 'docdb' || sourceId === 'docdb-instance' || targetId === 'docdb-instance') {
    return { label: 'database', connectionType: 'data', protocol: 'MongoDB', port: '27017' };
  }
  return { label: 'reference', connectionType: 'data', protocol: 'Terraform', port: '' };
}

function buildTerraformReferenceMap(input: UnknownRecord): Map<string, string | number> {
  const references = new Map<string, string | number>();

  for (const rootKey of ['data', 'resource']) {
    const root = input[rootKey];
    if (!isRecord(root)) continue;

    for (const [type, namedItems] of Object.entries(root)) {
      if (!isRecord(namedItems)) continue;
      for (const [name, attrs] of Object.entries(namedItems)) {
        if (!isRecord(attrs)) continue;
        for (const [attr, value] of Object.entries(attrs)) {
          const normalized = primitiveConfigValue(value);
          if (normalized === undefined) continue;
          const prefix = rootKey === 'data' ? `data.${type}.${name}` : `${type}.${name}`;
          references.set(`${prefix}.${attr}`, normalized);
        }
      }
    }
  }

  return references;
}

function resolveTerraformValue(value: unknown, references: Map<string, string | number>): string | number | undefined {
  const primitive = primitiveConfigValue(value);
  if (primitive === undefined) return undefined;
  if (typeof primitive !== 'string') return primitive;

  const reference = primitive.match(/^\${([^}]+)}$/)?.[1];
  if (!reference) return primitive;
  if (references.has(reference)) return references.get(reference);
  if (reference.startsWith('data.aws_ami.') && reference.endsWith('.id')) return undefined;
  return primitive;
}

function primitiveConfigValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  return undefined;
}

function labelFromTerraformResource(resourceName: string, config: UnknownRecord): string {
  const tags = isRecord(config.tags) ? config.tags : undefined;
  return stringValue(tags?.Name ?? config.name ?? config.function_name ?? config.bucket ?? resourceName);
}

function labelFromAwsRecord(serviceId: string, record: UnknownRecord): string {
  const tagName = tagValue(record.Tags, 'Name');
  const fallbackByService: Record<string, unknown> = {
    ec2: record.InstanceId,
    lambda: record.FunctionName,
    s3: record.Name,
    rds: record.DBInstanceIdentifier,
  };

  return stringValue(tagName ?? record.name ?? record.Name ?? record.id ?? record.Id ?? fallbackByService[serviceId]) || serviceById[serviceId].name;
}

function readTerraformProviderRegion(input: UnknownRecord): string | undefined {
  const provider = input.provider;
  if (!isRecord(provider)) return undefined;
  const aws = provider.aws;
  if (isRecord(aws)) return stringValue(aws.region) || undefined;
  if (Array.isArray(aws)) return stringValue(aws.find(isRecord)?.region) || undefined;
  return undefined;
}

function serviceIdFromResourceType(type: string): string | undefined {
  return terraformTypeToServiceId[type] ?? resourceTypeAliases[type];
}

function serviceIdFromServiceName(service: string): string | undefined {
  const normalized = service.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return awsServices.find((candidate) => normalized === candidate.id || normalized === candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, ''))?.id;
}

function statusFromAwsRecord(record: UnknownRecord): 'running' | 'stopped' | 'unknown' {
  const state = isRecord(record.State) ? record.State.Name : undefined;
  return statusFromValue(record.status ?? record.Status ?? state);
}

function statusFromValue(value: unknown): 'running' | 'stopped' | 'unknown' {
  return value === 'running' || value === 'stopped' ? value : 'unknown';
}

function tagValue(tags: unknown, key: string): string | undefined {
  if (!Array.isArray(tags)) return undefined;
  const tag = tags.find((item) => isRecord(item) && item.Key === key);
  return isRecord(tag) ? stringValue(tag.Value) || undefined : undefined;
}

function gridPosition(index: number): { x: number; y: number } {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return { x: 180 + column * 260, y: 140 + row * 190 };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
