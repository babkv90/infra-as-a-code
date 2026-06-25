import type { SavedDiagram } from '../dashboard/diagramApi';
import { serviceById } from './awsServices';
import { normalizeTerraformFiles } from '../utils/importDiagram';
import type { AwsEdge, AwsNode, EdgeConnectionType } from '../types';

const enterpriseDemoDiagramId = 'terraform-enterprise-demo';
const ec2EndToEndDiagramId = 'ec2-end-to-end-demo';
const ec2DefaultVpcDiagramId = 'ec2-default-vpc-demo';
const enterpriseDemoTerraformPath = '/demo/enterprise-production-platform.tf';

export function isEnterpriseDemoDiagram(diagramId?: string): boolean {
  return diagramId === enterpriseDemoDiagramId || diagramId === ec2EndToEndDiagramId || diagramId === ec2DefaultVpcDiagramId;
}

export async function loadDemoDiagrams(): Promise<SavedDiagram[]> {
  const diagrams = [loadEc2DefaultVpcDiagram(), loadEc2EndToEndDiagram()];

  try {
    diagrams.push(await loadEnterpriseDemoDiagram());
  } catch {
    // Keep the deployable EC2 demo available even if the Terraform demo file is unavailable.
  }

  return diagrams;
}

export async function loadEnterpriseDemoDiagram(): Promise<SavedDiagram> {
  const response = await fetch(enterpriseDemoTerraformPath, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error('Unable to load Terraform demo diagram.');
  }

  const content = await response.text();
  const snapshot = normalizeTerraformFiles([{ name: 'enterprise-production-platform.tf', content }]);

  return {
    _id: enterpriseDemoDiagramId,
    name: 'Enterprise production platform demo',
    description: 'Terraform-backed demo generated from public/demo/enterprise-production-platform.tf.',
    activeRegion: 'ap-south-1',
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    createdBy: 'Terraform demo file',
    updatedBy: 'Terraform demo file',
  };
}

function loadEc2DefaultVpcDiagram(): SavedDiagram {
  return {
    _id: ec2DefaultVpcDiagramId,
    name: 'Quota-safe EC2 in default VPC demo',
    description: 'Deployable visual template that avoids creating a new VPC by using the account default VPC and default subnets.',
    activeRegion: 'ap-south-1',
    nodes: ec2DefaultVpcNodes(),
    edges: ec2DefaultVpcEdges(),
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    createdBy: 'infraflow template',
    updatedBy: 'infraflow template',
  };
}

function loadEc2EndToEndDiagram(): SavedDiagram {
  return {
    _id: ec2EndToEndDiagramId,
    name: 'End-to-end public EC2 demo',
    description: 'Deployable visual template for a new VPC, public subnet, internet route, security group, EC2 instance, and CloudWatch alarm.',
    activeRegion: 'ap-south-1',
    nodes: ec2EndToEndNodes(),
    edges: ec2EndToEndEdges(),
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    createdBy: 'infraflow template',
    updatedBy: 'infraflow template',
  };
}

function ec2DefaultVpcNodes(): AwsNode[] {
  return [
    groupNode('group-existing-default-vpc', 'Existing default VPC (data source)', 'VPC', { x: 58, y: 54 }, { width: 760, height: 390 }),
    groupNode('group-default-public-subnet', 'Default subnet selected by Terraform', 'Public Subnet', { x: 284, y: 152 }, { width: 308, height: 216 }),
    serviceNode('default-vpc-ec2-sg', 'security-group', 'Security Group', 'default_vpc_ec2_sg', { x: 106, y: 170 }, {
      name: 'default-vpc-ec2-sg',
      description: 'Allow SSH and HTTP to the default VPC demo EC2 instance.',
      vpc_id: 'data.aws_vpc.default.id',
      ingress_ports: '22,80',
      ingress_cidr_blocks: '0.0.0.0/0',
      egress_cidr_blocks: '0.0.0.0/0',
    }),
    serviceNode('default-vpc-web-server', 'ec2', 'EC2', 'default_vpc_web_server', { x: 370, y: 230 }, {
      name: 'default-vpc-web-server',
      ami: 'data.aws_ami.amazon_linux_2023.id',
      instance_type: 't3.micro',
      subnet_id: 'data.aws_subnets.default.ids[0]',
      vpc_security_group_ids: '[aws_security_group.default_vpc_ec2_sg.id]',
      associate_public_ip_address: 'true',
      iam_role_arn: '',
      iam_instance_profile: '',
    }),
    serviceNode('default-vpc-ec2-cpu-alarm', 'cloudwatch', 'CloudWatch', 'default_vpc_ec2_cpu_alarm', { x: 620, y: 230 }, {
      alarm_name: 'default-vpc-web-server-high-cpu',
      comparison_operator: 'GreaterThanThreshold',
      evaluation_periods: 2,
      metric_name: 'CPUUtilization',
      namespace: 'AWS/EC2',
      period: 300,
      statistic: 'Average',
      threshold: 80,
    }),
  ];
}

function ec2EndToEndNodes(): AwsNode[] {
  return [
    groupNode('group-vpc-public-ec2', 'VPC: prod_vpc', 'VPC', { x: 28, y: 32 }, { width: 980, height: 560 }),
    groupNode('group-public-subnet-a', 'Public Subnet: public_subnet_a', 'Public Subnet', { x: 318, y: 178 }, { width: 410, height: 288 }),
    serviceNode('prod-vpc', 'vpc', 'VPC', 'prod_vpc', { x: 88, y: 118 }, {
      name: 'prod-vpc',
      cidr_block: '10.0.0.0/16',
      enable_dns_hostnames: 'true',
      enable_dns_support: 'true',
    }),
    serviceNode('prod-igw', 'igw', 'Internet Gateway', 'prod_igw', { x: 88, y: 330 }, {
      name: 'prod-igw',
      vpc_id: 'aws_vpc.prod_vpc.id',
    }),
    serviceNode('public-subnet-a', 'subnet', 'Subnet', 'public_subnet_a', { x: 380, y: 238 }, {
      name: 'public-subnet-a',
      vpc_id: 'aws_vpc.prod_vpc.id',
      cidr_block: '10.0.1.0/24',
      availability_zone: 'ap-south-1a',
      map_public_ip_on_launch: 'true',
    }),
    serviceNode('public-route-table', 'route-table', 'Route Table', 'public_route_table', { x: 382, y: 482 }, {
      name: 'public-route-table',
      vpc_id: 'aws_vpc.prod_vpc.id',
    }),
    serviceNode('internet-route', 'route', 'Route', 'internet_route', { x: 660, y: 482 }, {
      route_table_id: 'aws_route_table.public_route_table.id',
      destination_cidr_block: '0.0.0.0/0',
      gateway_id: 'aws_internet_gateway.prod_igw.id',
    }),
    serviceNode('public-route-association', 'route-association', 'Route Association', 'public_subnet_route_association', { x: 662, y: 238 }, {
      subnet_id: 'aws_subnet.public_subnet_a.id',
      route_table_id: 'aws_route_table.public_route_table.id',
    }),
    serviceNode('public-ec2-sg', 'security-group', 'Security Group', 'public_ec2_sg', { x: 780, y: 132 }, {
      name: 'public-ec2-sg',
      description: 'Allow SSH and HTTP to the demo EC2 instance.',
      vpc_id: 'aws_vpc.prod_vpc.id',
      ingress_ports: '22,80',
      ingress_cidr_blocks: '0.0.0.0/0',
      egress_cidr_blocks: '0.0.0.0/0',
    }),
    serviceNode('web-server', 'ec2', 'EC2', 'web_server', { x: 486, y: 330 }, {
      name: 'web-server',
      ami: 'data.aws_ami.amazon_linux_2023.id',
      instance_type: 't3.micro',
      subnet_id: 'aws_subnet.public_subnet_a.id',
      vpc_security_group_ids: '[aws_security_group.public_ec2_sg.id]',
      associate_public_ip_address: 'true',
      iam_role_arn: '',
      iam_instance_profile: '',
    }),
    serviceNode('ec2-cpu-alarm', 'cloudwatch', 'CloudWatch', 'ec2_cpu_alarm', { x: 790, y: 346 }, {
      alarm_name: 'web-server-high-cpu',
      comparison_operator: 'GreaterThanThreshold',
      evaluation_periods: 2,
      metric_name: 'CPUUtilization',
      namespace: 'AWS/EC2',
      period: 300,
      statistic: 'Average',
      threshold: 80,
    }),
  ];
}

function ec2DefaultVpcEdges(): AwsEdge[] {
  return [
    edge('edge-default-sg-ec2', 'default-vpc-ec2-sg', 'default-vpc-web-server', 'allow 22,80', 'security', '22,80'),
    edge('edge-default-ec2-cloudwatch', 'default-vpc-web-server', 'default-vpc-ec2-cpu-alarm', 'metrics', 'monitoring'),
  ];
}

function ec2EndToEndEdges(): AwsEdge[] {
  return [
    edge('edge-vpc-subnet', 'prod-vpc', 'public-subnet-a', 'Subnets', 'data'),
    edge('edge-vpc-igw', 'prod-vpc', 'prod-igw', 'attach', 'data'),
    edge('edge-vpc-route-table', 'prod-vpc', 'public-route-table', 'routes', 'data'),
    edge('edge-route-table-route', 'public-route-table', 'internet-route', 'default route', 'data'),
    edge('edge-route-igw', 'internet-route', 'prod-igw', '0.0.0.0/0', 'data'),
    edge('edge-subnet-association', 'public-subnet-a', 'public-route-association', 'associate', 'data'),
    edge('edge-route-table-association', 'public-route-table', 'public-route-association', 'associate', 'data'),
    edge('edge-subnet-ec2', 'public-subnet-a', 'web-server', 'ENI', 'data'),
    edge('edge-sg-ec2', 'public-ec2-sg', 'web-server', 'allow 22,80', 'security', '22,80'),
    edge('edge-ec2-cloudwatch', 'web-server', 'ec2-cpu-alarm', 'metrics', 'monitoring'),
  ];
}

function groupNode(id: string, label: string, groupKind: AwsNode['data']['groupKind'], position: AwsNode['position'], size: { width: number; height: number }): AwsNode {
  return {
    id,
    type: 'groupBox',
    position,
    width: size.width,
    height: size.height,
    style: size,
    zIndex: -1,
    selectable: true,
    draggable: true,
    data: {
      serviceName: label,
      label,
      region: 'ap-south-1',
      arn: '',
      status: 'unknown',
      color: '#2563eb',
      icon: 'BoxSelect',
      subLabel: 'boundary',
      ports: { inputs: [], outputs: [] },
      config: { region: 'ap-south-1', status: 'unknown' },
      groupKind,
    },
  };
}

function serviceNode(id: string, serviceId: string, serviceName: string, label: string, position: AwsNode['position'], config: AwsNode['data']['config']): AwsNode {
  const service = serviceById[serviceId];

  return {
    id,
    type: 'awsService',
    position,
    data: {
      serviceId,
      serviceName: service?.name ?? serviceName,
      label,
      region: 'ap-south-1',
      arn: '',
      status: 'unknown',
      color: service?.color ?? '#2563eb',
      icon: service?.icon ?? 'Cloud',
      subLabel: service?.subLabel ?? serviceName,
      ports: service?.ports ?? { inputs: [], outputs: [] },
      config: { region: 'ap-south-1', status: 'unknown', ...config },
    },
  };
}

function edge(id: string, source: string, target: string, label: string, connectionType: EdgeConnectionType, port = ''): AwsEdge {
  return {
    id,
    source,
    target,
    type: 'flowEdge',
    data: { label, connectionType, protocol: connectionType === 'security' ? 'TCP' : '', port },
  };
}
