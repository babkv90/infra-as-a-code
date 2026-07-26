import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDiagramPayload, normalizeDiagramSnapshot } from '../src/utils/diagramSchema.js';
import { outputAttributesForService, terraformTypeForService } from '../src/utils/resourceRegistry.js';
import { buildRelationshipGraph, validateRelationshipGraph } from '../src/utils/relationshipGraph.js';
import { validateDiagram } from '../src/utils/diagramValidator.js';
import { generateTerraform } from '../src/utils/terraformGenerator.js';

test('normalizes legacy visual-builder snapshots without changing valid nodes', () => {
  const snapshot = normalizeDiagramSnapshot({
    activeRegion: 'us-east-1',
    nodes: [
      {
        id: 'vpc-1',
        type: 'awsService',
        position: { x: 24, y: 48 },
        data: {
          serviceId: 'vpc',
          serviceName: 'VPC',
          label: 'Prod VPC',
          config: { cidr_block: '10.0.0.0/16' },
          customMetadata: 'kept',
        },
      },
    ],
    edges: [],
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.activeRegion, 'us-east-1');
  assert.equal(snapshot.nodes[0].id, 'vpc-1');
  assert.equal(snapshot.nodes[0].data.customMetadata, 'kept');
  assert.deepEqual(snapshot.nodes[0].data.config, { cidr_block: '10.0.0.0/16' });
});

test('drops edges that point at missing nodes before validation or generation', () => {
  const snapshot = normalizeDiagramSnapshot({
    nodes: [
      serviceNode('vpc-1', 'vpc', 'Prod VPC', { cidr_block: '10.0.0.0/16' }),
      serviceNode('subnet-1', 'subnet', 'Public Subnet', {
        cidr_block: '10.0.1.0/24',
        availability_zone: 'us-east-1a',
        map_public_ip_on_launch: 'true',
      }),
    ],
    edges: [
      edge('valid-edge', 'vpc-1', 'subnet-1'),
      edge('dangling-edge', 'vpc-1', 'missing-node'),
    ],
  });

  assert.deepEqual(snapshot.edges.map((item) => item.id), ['valid-edge']);
});

test('normalizes partial update payloads against existing diagram fallback', () => {
  const payload = normalizeDiagramPayload(
    { activeRegion: 'ap-south-1' },
    {
      nodes: [serviceNode('vpc-1', 'vpc', 'Prod VPC', { cidr_block: '10.0.0.0/16' })],
      edges: [],
    },
  );

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.activeRegion, 'ap-south-1');
  assert.equal(payload.nodes.length, 1);
});

test('adds explicit infrastructure parent references for contained nodes', () => {
  const snapshot = normalizeDiagramSnapshot({
    nodes: [
      {
        id: 'vpc-boundary',
        type: 'groupBox',
        position: { x: 0, y: 0 },
        width: 520,
        height: 340,
        data: {
          groupKind: 'VPC',
          serviceName: 'VPC',
          label: 'Prod VPC boundary',
          config: {},
        },
      },
      {
        ...serviceNode('ec2-1', 'ec2', 'App Server', { ami: 'ami-123', instance_type: 't3.micro' }),
        parentNode: 'vpc-boundary',
      },
    ],
    edges: [],
  });

  const server = snapshot.nodes.find((node) => node.id === 'ec2-1');

  assert.equal(server.data.infrastructure.parentId, 'vpc-boundary');
  assert.equal(server.data.infrastructure.boundaryId, 'vpc-boundary');
  assert.equal(server.data.infrastructure.vpcId, 'vpc-boundary');
  assert.equal(server.data.infrastructure.resourceType, 'ec2');
});

test('shared resource registry exposes Terraform metadata for validation and generation', () => {
  assert.equal(terraformTypeForService('vpc'), 'aws_vpc');
  assert.deepEqual(outputAttributesForService('subnet'), ['id', 'arn', 'cidr_block', 'availability_zone']);
});

test('builds typed relationships from existing visual edges', () => {
  const nodes = [
    serviceNode('vpc-1', 'vpc', 'Prod VPC', { cidr_block: '10.0.0.0/16' }),
    serviceNode('subnet-1', 'subnet', 'Public Subnet', { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' }),
  ];
  const relationships = buildRelationshipGraph(nodes, [edge('vpc-subnet', 'vpc-1', 'subnet-1')]);

  assert.equal(relationships[0].relationshipType, 'contains');
  assert.equal(relationships[0].sourceResourceId, 'vpc-1');
  assert.equal(relationships[0].targetResourceId, 'subnet-1');
});

test('detects relationship cycles without mutating visual edges', () => {
  const nodes = [
    serviceNode('lambda-1', 'lambda', 'Function', { role_arn: 'arn:aws:iam::123456789012:role/test', filename: 'lambda_stub.zip', handler: 'index.handler', runtime: 'nodejs20.x' }),
    serviceNode('event-1', 'eventbridge', 'Rule', { event_pattern: '{}' }),
  ];
  const edges = [edge('a', 'lambda-1', 'event-1'), edge('b', 'event-1', 'lambda-1')];
  const issues = validateRelationshipGraph(nodes, edges);

  assert.equal(edges[0].data.relationshipType, undefined);
  assert.equal(issues.some((issue) => /cycle/i.test(issue.message)), true);
});

test('validates subnet CIDRs against VPC containment and overlap rules', () => {
  const nodes = [
    serviceNode('vpc-1', 'vpc', 'Prod VPC', { cidr_block: '10.0.0.0/16' }),
    serviceNode('subnet-1', 'subnet', 'Public A', { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' }),
    serviceNode('subnet-2', 'subnet', 'Public B', { cidr_block: '10.0.1.128/25', availability_zone: 'us-east-1b' }),
    serviceNode('subnet-3', 'subnet', 'Outside', { cidr_block: '10.1.1.0/24', availability_zone: 'us-east-1c' }),
  ];
  const edges = [edge('vpc-subnet-a', 'vpc-1', 'subnet-1'), edge('vpc-subnet-b', 'vpc-1', 'subnet-2'), edge('vpc-subnet-c', 'vpc-1', 'subnet-3')];
  const issues = validateDiagram(nodes, edges, 'us-east-1');

  assert.equal(issues.some((issue) => issue.nodeId === 'subnet-2' && /overlaps/i.test(issue.message)), true);
  assert.equal(issues.some((issue) => issue.nodeId === 'subnet-3' && /inside/i.test(issue.message)), true);
});

test('keeps existing valid diagram-to-terraform output path working', () => {
  const nodes = [
    serviceNode('vpc-1', 'vpc', 'Prod VPC', {
      cidr_block: '10.0.0.0/16',
      enable_dns_hostnames: 'true',
      enable_dns_support: 'true',
    }),
    serviceNode('subnet-1', 'subnet', 'Public Subnet', {
      cidr_block: '10.0.1.0/24',
      availability_zone: 'us-east-1a',
      map_public_ip_on_launch: 'true',
    }),
  ];
  const edges = [edge('vpc-subnet', 'vpc-1', 'subnet-1')];
  const issues = validateDiagram(nodes, edges, 'us-east-1');
  const terraform = generateTerraform(nodes, edges, { region: 'us-east-1', suffix: 'regression' });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.match(terraform, /provider "aws"/);
  assert.match(terraform, /resource "aws_vpc"/);
  assert.match(terraform, /resource "aws_subnet"/);
  assert.match(terraform, /vpc_id\s+=\s+aws_vpc\./);
});

function serviceNode(id, serviceId, label, config) {
  return {
    id,
    type: 'awsService',
    position: { x: 0, y: 0 },
    data: {
      serviceId,
      serviceName: label,
      label,
      region: 'us-east-1',
      arn: '',
      status: 'running',
      color: '#2563eb',
      icon: 'Box',
      subLabel: 'us-east-1',
      ports: { inputs: [], outputs: [] },
      config: { region: 'us-east-1', status: 'running', ...config },
    },
  };
}

function edge(id, source, target) {
  return {
    id,
    source,
    target,
    type: 'flowEdge',
    data: {
      label: 'network',
      connectionType: 'data',
      protocol: 'VPC',
      port: '',
    },
  };
}
