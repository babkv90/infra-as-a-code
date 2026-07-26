import type { AwsNode, GroupKind, NodeInfrastructureState, NodeVisualState } from '../types';

const boundaryKeyByKind: Partial<Record<GroupKind, keyof NodeInfrastructureState>> = {
  Region: 'regionId',
  VPC: 'vpcId',
  'Availability Zone': 'availabilityZoneId',
  'Public Subnet': 'subnetId',
  'Private Subnet': 'subnetId',
};

export function nodeVisualState(node: AwsNode): NodeVisualState {
  return {
    x: node.position.x,
    y: node.position.y,
    width: numberValue(node.width ?? node.style?.width),
    height: numberValue(node.height ?? node.style?.height),
  };
}

export function nodeInfrastructureState(node: AwsNode, parent?: AwsNode): NodeInfrastructureState {
  const current = node.data.infrastructure ?? {};
  const boundaryKind = node.type === 'groupBox' ? node.data.groupKind : current.boundaryKind;
  const parentKey = parent?.data.groupKind ? boundaryKeyByKind[parent.data.groupKind] : undefined;
  const parentId = parent?.id;

  return {
    ...current,
    resourceType: node.data.serviceId ?? current.resourceType,
    boundaryKind,
    parentId,
    boundaryId: parentId ?? current.boundaryId,
    ...(parentKey && parentId ? { [parentKey]: parentId } : {}),
  };
}

export function withTopologySemantics(node: AwsNode, parent?: AwsNode): AwsNode {
  return {
    ...node,
    data: {
      ...node.data,
      visual: nodeVisualState(node),
      infrastructure: nodeInfrastructureState(node, parent),
    },
  };
}

export function isBoundaryNode(node: AwsNode): boolean {
  return node.type === 'groupBox' && Boolean(node.data.groupKind);
}

export function canContainNode(parent: AwsNode, child: AwsNode): boolean {
  if (!isBoundaryNode(parent) || child.type === 'groupBox' || child.type === 'labelNode') return false;
  const serviceId = child.data.serviceId;

  if (parent.data.groupKind === 'Security Group') return serviceId === 'security-group';
  if (parent.data.groupKind === 'Public Subnet' || parent.data.groupKind === 'Private Subnet') {
    return ['ec2', 'ecs', 'eks', 'lambda', 'rds', 'docdb', 'docdb-instance', 'elasticache', 'nat', 'alb'].includes(serviceId ?? '');
  }
  if (parent.data.groupKind === 'VPC') {
    return ['vpc', 'subnet', 'igw', 'nat', 'route-table', 'route', 'route-association', 'security-group', 'alb', 'lb-target-group', 'ec2', 'ecs', 'eks', 'lambda', 'rds', 'docdb', 'docdb-instance', 'elasticache'].includes(serviceId ?? '');
  }

  return parent.data.groupKind === 'Region' || parent.data.groupKind === 'Terraform stack' || parent.data.groupKind === 'Module';
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
