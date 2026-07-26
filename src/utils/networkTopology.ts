import type { AwsEdge, AwsNode } from '../types';

export type NetworkTopologyIssue = {
  nodeId?: string;
  severity: 'warning' | 'error';
  message: string;
};

type CidrRange = { cidr: string; start: number; end: number; prefix: number };

export function validateNetworkTopology(nodes: AwsNode[], edges: AwsEdge[]): NetworkTopologyIssue[] {
  const issues: NetworkTopologyIssue[] = [];
  const serviceNodes = nodes.filter((node) => node.type === 'awsService');
  const vpcs = serviceNodes.filter((node) => node.data.serviceId === 'vpc');
  const subnets = serviceNodes.filter((node) => node.data.serviceId === 'subnet');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const vpcRanges = new Map<string, CidrRange>();
  for (const vpc of vpcs) {
    const cidr = String(vpc.data.config?.cidr_block ?? '').trim();
    const parsed = parseIpv4Cidr(cidr);
    if (!cidr) continue;
    if (!parsed) {
      issues.push({ nodeId: vpc.id, severity: 'error', message: `${vpc.data.label || 'VPC'} has an invalid IPv4 CIDR block.` });
      continue;
    }
    vpcRanges.set(vpc.id, parsed);
  }

  const subnetRanges: Array<{ node: AwsNode; range: CidrRange; vpc?: AwsNode }> = [];
  for (const subnet of subnets) {
    const cidr = String(subnet.data.config?.cidr_block ?? '').trim();
    const parsed = parseIpv4Cidr(cidr);
    if (!cidr) continue;
    if (!parsed) {
      issues.push({ nodeId: subnet.id, severity: 'error', message: `${subnet.data.label || 'Subnet'} has an invalid IPv4 CIDR block.` });
      continue;
    }
    if (parsed.prefix < 16 || parsed.prefix > 28) {
      issues.push({ nodeId: subnet.id, severity: 'warning', message: `${subnet.data.label || 'Subnet'} uses /${parsed.prefix}; production AWS subnets are usually sized between /20 and /28.` });
    }

    const vpc = findRelatedVpc(subnet, nodes, edges, nodeById);
    if (!vpc) {
      issues.push({ nodeId: subnet.id, severity: 'error', message: `${subnet.data.label || 'Subnet'} must be connected to or contained by exactly one VPC.` });
    } else {
      const vpcRange = vpcRanges.get(vpc.id);
      if (vpcRange && !containsRange(vpcRange, parsed)) {
        issues.push({ nodeId: subnet.id, severity: 'error', message: `${subnet.data.label || 'Subnet'} CIDR must be inside ${vpc.data.label || 'the selected VPC'} CIDR.` });
      }
    }
    subnetRanges.push({ node: subnet, range: parsed, vpc });
  }

  for (let leftIndex = 0; leftIndex < subnetRanges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < subnetRanges.length; rightIndex += 1) {
      const left = subnetRanges[leftIndex];
      const right = subnetRanges[rightIndex];
      if (left.vpc?.id && right.vpc?.id && left.vpc.id !== right.vpc.id) continue;
      if (overlaps(left.range, right.range)) {
        issues.push({ nodeId: right.node.id, severity: 'error', message: `${right.node.data.label || 'Subnet'} CIDR overlaps with ${left.node.data.label || 'another subnet'}.` });
      }
    }
  }

  for (const nat of serviceNodes.filter((node) => node.data.serviceId === 'nat')) {
    const subnet = findRelatedSubnet(nat, nodes, edges, nodeById);
    if (String(nat.data.config?.connectivity_type ?? '').toLowerCase() === 'public' && subnet && !isPublicSubnet(subnet)) {
      issues.push({ nodeId: nat.id, severity: 'error', message: 'Public NAT Gateway must be placed in or connected to a public subnet.' });
    }
  }

  for (const db of serviceNodes.filter((node) => ['rds', 'docdb', 'docdb-instance', 'elasticache'].includes(node.data.serviceId ?? ''))) {
    const subnet = findRelatedSubnet(db, nodes, edges, nodeById);
    if (subnet && isPublicSubnet(subnet) && db.data.config?.allow_public_database !== 'true') {
      issues.push({ nodeId: db.id, severity: 'warning', message: `${db.data.label || db.data.serviceName} is associated with a public subnet; use private or isolated subnets unless explicitly approved.` });
    }
  }

  return issues;
}

function findRelatedVpc(node: AwsNode, nodes: AwsNode[], edges: AwsEdge[], nodeById: Map<string, AwsNode>): AwsNode | undefined {
  const semanticVpcId = node.data.infrastructure?.vpcId;
  if (semanticVpcId) {
    const vpc = nodeById.get(semanticVpcId);
    if (vpc?.data.serviceId === 'vpc' || vpc?.data.groupKind === 'VPC') return vpc;
  }

  const connectedVpc = connectedNode(node, edges, nodeById, 'vpc');
  if (connectedVpc) return connectedVpc;
  const vpcs = nodes.filter((candidate) => candidate.data.serviceId === 'vpc');
  return vpcs.length === 1 ? vpcs[0] : undefined;
}

function findRelatedSubnet(node: AwsNode, nodes: AwsNode[], edges: AwsEdge[], nodeById: Map<string, AwsNode>): AwsNode | undefined {
  const semanticSubnetId = node.data.infrastructure?.subnetId;
  if (semanticSubnetId) {
    const subnet = nodeById.get(semanticSubnetId);
    if (subnet?.data.serviceId === 'subnet' || subnet?.data.groupKind === 'Public Subnet' || subnet?.data.groupKind === 'Private Subnet') return subnet;
  }
  return connectedNode(node, edges, nodeById, 'subnet') ?? (nodes.filter((candidate) => candidate.data.serviceId === 'subnet').length === 1 ? nodes.find((candidate) => candidate.data.serviceId === 'subnet') : undefined);
}

function connectedNode(node: AwsNode, edges: AwsEdge[], nodeById: Map<string, AwsNode>, serviceId: string): AwsNode | undefined {
  for (const edge of edges) {
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const other = nodeById.get(edge.source === node.id ? edge.target : edge.source);
    if (other?.data.serviceId === serviceId) return other;
  }
  return undefined;
}

function isPublicSubnet(node: AwsNode): boolean {
  return node.data.groupKind === 'Public Subnet' || String(node.data.config?.map_public_ip_on_launch ?? '').toLowerCase() === 'true' || node.data.label.toLowerCase().includes('public');
}

function parseIpv4Cidr(value: string): CidrRange | undefined {
  const match = value.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return undefined;
  const base = ipv4ToNumber(match[1]);
  const prefix = Number(match[2]);
  if (base === undefined || prefix < 0 || prefix > 32) return undefined;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(base / size) * size;
  return { cidr: value, start, end: start + size - 1, prefix };
}

function ipv4ToNumber(value: string): number | undefined {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts.reduce((total, part) => total * 256 + part, 0);
}

function containsRange(parent: CidrRange, child: CidrRange): boolean {
  return child.start >= parent.start && child.end <= parent.end;
}

function overlaps(left: CidrRange, right: CidrRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}
