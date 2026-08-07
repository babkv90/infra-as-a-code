import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { compareSiblingKeys, computeDeterministicOrder, computeTiers, isPublicSubnetViaRouting, siblingSortKey } from './topologyOrdering';

describe('isPublicSubnetViaRouting', () => {
  it('is true when a subnet routes to an internet gateway via a route table', () => {
    const nodes = [node('subnet-1', 'subnet'), node('rta-1', 'route-association'), node('rt-1', 'route-table'), node('route-1', 'route'), node('igw-1', 'igw')];
    const edges = [
      resolvesEdge('e1', 'subnet-1', 'rta-1', 'subnet_id'),
      resolvesEdge('e2', 'rt-1', 'rta-1', 'route_table_id'),
      resolvesEdge('e3', 'rt-1', 'route-1', 'route_table_id'),
      resolvesEdge('e4', 'igw-1', 'route-1', 'gateway_id'),
    ];
    expect(isPublicSubnetViaRouting('subnet-1', nodes, edges)).toBe(true);
  });

  it('is false for a subnet whose route table has no route to an internet gateway', () => {
    const nodes = [node('subnet-1', 'subnet'), node('rta-1', 'route-association'), node('rt-1', 'route-table')];
    const edges = [resolvesEdge('e1', 'subnet-1', 'rta-1', 'subnet_id'), resolvesEdge('e2', 'rt-1', 'rta-1', 'route_table_id')];
    expect(isPublicSubnetViaRouting('subnet-1', nodes, edges)).toBe(false);
  });

  it('is false for a subnet with no routing association modelled at all', () => {
    expect(isPublicSubnetViaRouting('subnet-1', [node('subnet-1', 'subnet')], [])).toBe(false);
  });
});

describe('computeTiers', () => {
  it('assigns 0 to ingress, increasing tiers along data-flow traffic', () => {
    const nodes = [node('alb', 'alb'), node('app', 'ec2'), node('db', 'rds')];
    const edges = [dataFlowEdge('e1', 'alb', 'app'), dataFlowEdge('e2', 'app', 'db')];
    const tiers = computeTiers(nodes, edges, nodes);
    expect(tiers.get('alb')).toBe(0);
    expect(tiers.get('app')).toBe(1);
    expect(tiers.get('db')).toBe(2);
  });

  it('falls back to static type rank for nodes unreachable from any ingress, so an unedged stack still sorts', () => {
    const nodes = [node('app', 'ec2'), node('db', 'rds'), node('cache', 'elasticache'), node('bucket', 's3')];
    const tiers = computeTiers(nodes, [], nodes);
    expect(tiers.get('app')).toBe(1); // compute
    expect(tiers.get('cache')).toBe(2); // cache
    expect(tiers.get('db')).toBe(3); // database
    expect(tiers.get('bucket')).toBe(4); // storage
  });

  it('takes the longest path when a node is reachable through more than one chain', () => {
    const nodes = [node('alb', 'alb'), node('app-a', 'ec2'), node('app-b', 'lambda'), node('db', 'rds')];
    const edges = [dataFlowEdge('e1', 'alb', 'app-a'), dataFlowEdge('e2', 'app-a', 'app-b'), dataFlowEdge('e3', 'alb', 'app-b'), dataFlowEdge('e4', 'app-b', 'db')];
    const tiers = computeTiers(nodes, edges, nodes);
    // app-b is reachable directly from alb (tier 1) and via app-a (tier 2) — longest path wins.
    expect(tiers.get('app-b')).toBe(2);
    expect(tiers.get('db')).toBe(3);
  });
});

describe('sibling sort key', () => {
  it('sorts public before private, then AZ ascending, then type rank, then name', () => {
    const nodesById = new Map<string, AwsNode>([
      ['public-box', boxNode('public-box', 'Public Subnet')],
      ['private-box', boxNode('private-box', 'Private Subnet')],
    ]);
    const publicEc2 = { ...node('a', 'ec2'), parentNode: 'public-box' };
    const privateEc2Z1 = { ...node('b', 'ec2', { availability_zone: 'us-east-1a' }), parentNode: 'private-box' };
    const privateEc2Z2 = { ...node('c', 'ec2', { availability_zone: 'us-east-1b' }), parentNode: 'private-box' };

    const keys = [privateEc2Z2, privateEc2Z1, publicEc2].map((n) => ({ id: n.id, key: siblingSortKey(n, nodesById) }));
    keys.sort((left, right) => compareSiblingKeys(left.key, right.key));

    expect(keys.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('computeDeterministicOrder — same stack, any insertion order, identical result', () => {
  it('produces the same node order regardless of the order fixtures are built in', () => {
    const build = (order: string[]): AwsNode[] => {
      const catalogue: Record<string, AwsNode> = {
        cdn: node('cdn', 'cloudfront'),
        alb: node('alb', 'alb'),
        'app-a': node('app-a', 'ec2', { availability_zone: 'us-east-1a' }),
        'app-b': node('app-b', 'ec2', { availability_zone: 'us-east-1b' }),
        db: node('db', 'rds'),
        bucket: node('bucket', 's3'),
      };
      return order.map((id) => catalogue[id]);
    };
    const edgesFor = (): AwsEdge[] => [
      dataFlowEdge('e1', 'cdn', 'alb'),
      dataFlowEdge('e2', 'alb', 'app-a'),
      dataFlowEdge('e3', 'alb', 'app-b'),
      dataFlowEdge('e4', 'app-a', 'db'),
      dataFlowEdge('e5', 'app-b', 'db'),
    ];

    const orderA = build(['cdn', 'alb', 'app-a', 'app-b', 'db', 'bucket']);
    const orderB = build(['bucket', 'db', 'app-b', 'app-a', 'alb', 'cdn']);
    const orderC = build(['app-b', 'cdn', 'db', 'alb', 'bucket', 'app-a']);

    const resultA = computeDeterministicOrder(orderA, edgesFor(), orderA).map((n) => n.id);
    const resultB = computeDeterministicOrder(orderB, edgesFor(), orderB).map((n) => n.id);
    const resultC = computeDeterministicOrder(orderC, edgesFor(), orderC).map((n) => n.id);

    expect(resultB).toEqual(resultA);
    expect(resultC).toEqual(resultA);
  });
});

function node(id: string, serviceId: string, config: Record<string, string> = {}): AwsNode {
  return {
    id,
    type: 'awsService',
    position: { x: 0, y: 0 },
    width: 218,
    height: 124,
    data: {
      serviceId,
      serviceName: serviceId,
      label: id,
      region: 'us-east-1',
      arn: '',
      status: 'unknown',
      color: '#2563eb',
      icon: 'Box',
      subLabel: '',
      ports: { inputs: ['in'], outputs: ['out'] },
      config,
    },
  };
}

function boxNode(id: string, groupKind: AwsNode['data']['groupKind']): AwsNode {
  return {
    id,
    type: 'groupBox',
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    data: {
      serviceName: groupKind ?? '',
      label: id,
      region: 'us-east-1',
      arn: '',
      status: 'unknown',
      color: '#2563eb',
      icon: 'BoxSelect',
      subLabel: 'boundary',
      ports: { inputs: [], outputs: [] },
      config: {},
      groupKind,
    },
  };
}

function resolvesEdge(id: string, source: string, target: string, field: string): AwsEdge {
  return {
    id,
    source,
    target,
    type: 'flowEdge',
    data: { label: `resolves ${field}`, connectionType: 'network-routing', protocol: '', port: '', resolvesField: field, relationshipKind: 'resolves' },
  };
}

function dataFlowEdge(id: string, source: string, target: string): AwsEdge {
  return { id, source, target, type: 'flowEdge', data: { label: 'traffic', connectionType: 'data-flow', protocol: 'HTTPS', port: '' } };
}
