import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { deriveContainment } from './deriveContainment';
import { exportTerraform } from './exportTerraform';
import { createAbsolutePositionResolver } from './topologySemantics';

describe('deriveContainment', () => {
  it('nests vpc -> subnet -> resource from resolves edges, box-in-box', () => {
    const nodes = [
      node('vpc-1', 'vpc', { x: 0, y: 0 }),
      node('subnet-1', 'subnet', { x: 400, y: 0 }),
      node('ec2-1', 'ec2', { x: 800, y: 40 }),
      // Public/private is derived from the actual routing model (subnet -> route-association ->
      // route-table -> route -> igw), not a name or the map_public_ip_on_launch convenience flag —
      // this chain is what makes subnet-1 resolve to 'Public Subnet' below.
      node('rta-1', 'route-association', { x: 400, y: 200 }),
      node('rt-1', 'route-table', { x: 400, y: 300 }),
      node('route-1', 'route', { x: 400, y: 400 }),
      node('igw-1', 'igw', { x: 0, y: 400 }),
    ];
    const edges = [
      resolvesEdge('e1', 'vpc-1', 'subnet-1', 'vpc_id'),
      resolvesEdge('e2', 'subnet-1', 'ec2-1', 'subnet_id'),
      resolvesEdge('e3', 'subnet-1', 'rta-1', 'subnet_id'),
      resolvesEdge('e4', 'rt-1', 'rta-1', 'route_table_id'),
      resolvesEdge('e5', 'rt-1', 'route-1', 'route_table_id'),
      resolvesEdge('e6', 'igw-1', 'route-1', 'gateway_id'),
    ];

    const result = deriveContainment(nodes, edges);
    const byId = new Map(result.map((n) => [n.id, n]));

    const vpcBox = result.find((n) => n.type === 'groupBox' && n.data.groupKind === 'VPC');
    const subnetBox = result.find((n) => n.type === 'groupBox' && n.data.groupKind === 'Public Subnet');
    expect(vpcBox).toBeDefined();
    expect(subnetBox).toBeDefined();
    expect(vpcBox!.data.derivedContainer).toBe(true);
    expect(subnetBox!.parentNode).toBe(vpcBox!.id);

    // parents appear before children in the array (a React Flow requirement)
    expect(result.indexOf(vpcBox!)).toBeLessThan(result.indexOf(subnetBox!));
    expect(result.indexOf(subnetBox!)).toBeLessThan(result.findIndex((n) => n.id === 'ec2-1'));

    expect(byId.get('vpc-1')!.parentNode).toBe(vpcBox!.id);
    expect(byId.get('subnet-1')!.parentNode).toBe(subnetBox!.id);
    expect(byId.get('ec2-1')!.parentNode).toBe(subnetBox!.id);
    expect(byId.get('ec2-1')!.data.externalLane).toBeUndefined();
  });

  it('sizes the vpc box to actually enclose its nested subnet box, not just its own direct children', () => {
    // vpc's only resolved child is the subnet itself (a container, redirected to box-in-box nesting
    // rather than becoming a direct card child) — if the vpc box's bounds were computed from its own
    // direct children only, it would be sized just around the tiny vpc card, and the subnet box (with
    // ec2 inside it) would render outside the vpc's drawn rectangle despite parentNode saying nested.
    const nodes = [node('vpc-1', 'vpc', { x: 0, y: 0 }), node('subnet-1', 'subnet', { x: 900, y: 900 }), node('ec2-1', 'ec2', { x: 940, y: 940 })];
    const edges = [resolvesEdge('e1', 'vpc-1', 'subnet-1', 'vpc_id'), resolvesEdge('e2', 'subnet-1', 'ec2-1', 'subnet_id')];

    const result = deriveContainment(nodes, edges);
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const vpcBox = result.find((n) => n.type === 'groupBox' && n.data.groupKind === 'VPC')!;
    const subnetBox = result.find((n) => n.type === 'groupBox' && n.data.groupKind !== 'VPC')!;
    const vpcAbsolute = resolveAbsolute(vpcBox.id);
    const subnetAbsolute = resolveAbsolute(subnetBox.id);
    const vpcWidth = Number(vpcBox.width);
    const vpcHeight = Number(vpcBox.height);
    const subnetWidth = Number(subnetBox.width);
    const subnetHeight = Number(subnetBox.height);

    // The subnet box's full rect must fall within the vpc box's rect on every edge.
    expect(subnetAbsolute.x).toBeGreaterThanOrEqual(vpcAbsolute.x);
    expect(subnetAbsolute.y).toBeGreaterThanOrEqual(vpcAbsolute.y);
    expect(subnetAbsolute.x + subnetWidth).toBeLessThanOrEqual(vpcAbsolute.x + vpcWidth);
    expect(subnetAbsolute.y + subnetHeight).toBeLessThanOrEqual(vpcAbsolute.y + vpcHeight);
  });

  it('tags a resource with no containment relationship for the external lane', () => {
    const nodes = [node('vpc-1', 'vpc', { x: 0, y: 0 }), node('bucket-1', 's3', { x: 600, y: 0 })];
    const result = deriveContainment(nodes, []);
    const bucket = result.find((n) => n.id === 'bucket-1')!;
    expect(bucket.parentNode).toBeUndefined();
    expect(bucket.data.externalLane).toBe(true);
  });

  it('never reassigns a node already manually parented into a hand-drawn boundary', () => {
    const manualBox: AwsNode = {
      id: 'manual-box',
      type: 'groupBox',
      position: { x: 0, y: 0 },
      width: 520,
      height: 340,
      data: {
        serviceName: 'VPC',
        label: 'Hand-drawn VPC',
        region: 'us-east-1',
        arn: '',
        status: 'unknown',
        color: '#2563eb',
        icon: 'BoxSelect',
        subLabel: 'boundary',
        ports: { inputs: [], outputs: [] },
        config: {},
        groupKind: 'VPC',
      },
    };
    const vpc = node('vpc-1', 'vpc', { x: 0, y: 0 });
    const subnet = { ...node('subnet-1', 'subnet', { x: 40, y: 40 }), parentNode: 'manual-box', extent: 'parent' as const };
    const edges = [resolvesEdge('e1', 'vpc-1', 'subnet-1', 'vpc_id')];

    const result = deriveContainment([manualBox, vpc, subnet], edges);
    const subnetResult = result.find((n) => n.id === 'subnet-1')!;
    expect(subnetResult.parentNode).toBe('manual-box');
  });

  it('releases a leaf whose containment edge was removed back to its last absolute position', () => {
    // subnet-1 is itself a container, so it always keeps a parentNode into its own box regardless of
    // whether it has a vpc relationship — the case worth covering is a genuine leaf (ec2) losing the
    // edge that nested it.
    const nodes = [node('subnet-1', 'subnet', { x: 0, y: 0 }), node('ec2-1', 'ec2', { x: 400, y: 0 })];
    const firstPass = deriveContainment(nodes, [resolvesEdge('e1', 'subnet-1', 'ec2-1', 'subnet_id')]);
    expect(firstPass.find((n) => n.id === 'ec2-1')!.parentNode).toBeDefined();

    // Same nodes (ec2 now nested under the derived box), but the resolving edge is gone.
    const secondPass = deriveContainment(firstPass, []);
    const ec2 = secondPass.find((n) => n.id === 'ec2-1')!;
    expect(ec2.parentNode).toBeUndefined();
    expect(ec2.data.externalLane).toBe(true);
  });

  it('produces byte-identical Terraform output — the projection only touches position/parentNode', () => {
    const nodes = [
      node('vpc-1', 'vpc', { x: 0, y: 0 }, { cidr_block: '10.0.0.0/16' }),
      node('subnet-1', 'subnet', { x: 400, y: 0 }, { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' }),
      node('ec2-1', 'ec2', { x: 800, y: 40 }, { instance_type: 't3.micro' }),
    ];
    const edges = [resolvesEdge('e1', 'vpc-1', 'subnet-1', 'vpc_id'), resolvesEdge('e2', 'subnet-1', 'ec2-1', 'subnet_id')];

    const before = exportTerraform(nodes, edges);
    const after = exportTerraform(deriveContainment(nodes, edges), edges);
    expect(after).toBe(before);
  });
});

describe('createAbsolutePositionResolver', () => {
  it('walks the full ancestor chain, not just one level', () => {
    const grandparent: AwsNode = boxNode('region-box', undefined, { x: 100, y: 50 });
    const parent: AwsNode = boxNode('vpc-box', 'region-box', { x: 30, y: 20 });
    const leaf = { ...node('ec2-1', 'ec2', { x: 10, y: 5 }), parentNode: 'vpc-box', extent: 'parent' as const };

    const resolve = createAbsolutePositionResolver([grandparent, parent, leaf]);
    expect(resolve('ec2-1')).toEqual({ x: 140, y: 75 });
  });
});

function node(id: string, serviceId: string, position: { x: number; y: number }, config: Record<string, string> = {}): AwsNode {
  return {
    id,
    type: 'awsService',
    position,
    width: 218,
    height: 124,
    style: { width: 218, height: 124 },
    data: {
      serviceId,
      serviceName: serviceId,
      label: `${serviceId}-${id}`,
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

function boxNode(id: string, parentNode: string | undefined, position: { x: number; y: number }): AwsNode {
  return {
    id,
    type: 'groupBox',
    position,
    parentNode,
    extent: parentNode ? 'parent' : undefined,
    width: 800,
    height: 600,
    data: {
      serviceName: 'Region',
      label: id,
      region: 'us-east-1',
      arn: '',
      status: 'unknown',
      color: '#0f766e',
      icon: 'BoxSelect',
      subLabel: 'boundary',
      ports: { inputs: [], outputs: [] },
      config: {},
      groupKind: 'Region',
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
