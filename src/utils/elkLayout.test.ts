import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { applyElkLayeredLayout, normalizeSemanticEdges } from './elkLayout';
import { exportTerraform } from './exportTerraform';

describe('ELK layered layout', () => {
  it('places nodes left-to-right without overlap', async () => {
    const nodes = [
      node('cdn', 'cloudfront'),
      node('alb', 'alb'),
      node('app-a', 'ec2'),
      node('app-b', 'lambda'),
      node('db', 'rds'),
      node('logs', 'cloudwatch'),
    ];
    const edges = normalizeSemanticEdges(
      [
        edge('e1', 'cdn', 'alb', 'traffic'),
        edge('e2', 'alb', 'app-a', 'traffic'),
        edge('e3', 'alb', 'app-b', 'traffic'),
        edge('e4', 'app-a', 'db', 'database'),
        edge('e5', 'app-b', 'db', 'database'),
        edge('e6', 'app-a', 'logs', 'metrics'),
      ],
      nodes,
    );

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const serviceNodes = laidOut.filter((candidate) => candidate.type === 'awsService');
    expect(serviceNodes).toHaveLength(nodes.length);
    expect(positionOf(serviceNodes, 'cdn').x).toBeLessThan(positionOf(serviceNodes, 'alb').x);
    expect(positionOf(serviceNodes, 'alb').x).toBeLessThan(positionOf(serviceNodes, 'app-a').x);
    expect(positionOf(serviceNodes, 'app-a').x).toBeLessThan(positionOf(serviceNodes, 'db').x);
    expect(hasOverlap(serviceNodes)).toBe(false);
  });

  it('never lets the fresh layout land on top of a pinned node — pinned nodes are excluded from the ELK graph entirely, so ELK has no idea they exist', async () => {
    // A pin sitting right where ELK's own layout naturally starts (near its root padding origin) is
    // exactly the case a blind "just exclude it" implementation gets wrong.
    const pinnedBase = node('legacy-app', 'ec2');
    const pinned = { ...pinnedBase, position: { x: 100, y: 100 }, data: { ...pinnedBase.data, pinned: true } };
    const nodes = [pinned, node('cdn', 'cloudfront'), node('alb', 'alb'), node('app-a', 'ec2'), node('db', 'rds')];
    const edges = [edge('e1', 'cdn', 'alb', 'traffic'), edge('e2', 'alb', 'app-a', 'traffic'), edge('e3', 'app-a', 'db', 'database')];

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const serviceNodes = laidOut.filter((candidate) => candidate.type === 'awsService');
    const pinnedResult = serviceNodes.find((candidate) => candidate.id === 'legacy-app')!;
    expect(pinnedResult.position).toEqual({ x: 100, y: 100 }); // still untouched, per the pinning contract
    expect(hasOverlap(serviceNodes)).toBe(false);
  });

  it('does not overlap same-semantic-layer nodes that sit at different tiers (a multi-hop compute chain alongside a parallel one-hop node)', async () => {
    // alb -> ec2-a -> ec2-b is a two-hop chain (ec2-a tier 1, ec2-b tier 2); ec2-c is a one-hop
    // parallel branch (tier 1). All three are 'compute' in semanticLayerForNode's bucket, so
    // snapNodesToLayerColumns forces them into the same x column even though ELK originally placed
    // tier 1 and tier 2 in separate fine-grained layers with independently-computed y positions.
    const nodes = [node('alb', 'alb'), node('ec2-a', 'ec2'), node('ec2-b', 'ec2'), node('ec2-c', 'ec2'), node('db', 'rds')];
    const edges = [
      edge('e1', 'alb', 'ec2-a', 'traffic'),
      edge('e2', 'ec2-a', 'ec2-b', 'traffic'),
      edge('e3', 'alb', 'ec2-c', 'traffic'),
      edge('e4', 'ec2-b', 'db', 'database'),
    ];

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const serviceNodes = laidOut.filter((candidate) => candidate.type === 'awsService');
    expect(hasOverlap(serviceNodes)).toBe(false);
  });

  it('never moves a pinned node, and clears its stale parentNode/extent so it is ready to be re-derived at its resolved absolute position', async () => {
    const pinned = { ...node('db', 'rds'), position: { x: 999, y: 777 }, parentNode: 'derived-container-subnet-1', extent: 'parent' as const, data: { ...node('db', 'rds').data, pinned: true } };
    const nodes = [node('alb', 'alb'), node('app-a', 'ec2'), pinned];
    const edges = [edge('e1', 'alb', 'app-a', 'traffic'), edge('e2', 'app-a', 'db', 'database')];

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const db = laidOut.find((candidate) => candidate.id === 'db')!;
    // Deliberately off-grid (999, 777) to prove pinning truly skips re-snapping — a node reaching
    // here via a real drag would already be grid-aligned by React Flow's own snapToGrid.
    expect(db.position).toEqual({ x: 999, y: 777 });
    expect(db.parentNode).toBeUndefined();
    expect(db.extent).toBeUndefined();
  });

  it('preserves a manually-drawn boundary and its contained resource untouched, positioned before it in the array', async () => {
    const manualBox: AwsNode = {
      id: 'manual-vpc',
      type: 'groupBox',
      position: { x: 500, y: 500 },
      width: 400,
      height: 300,
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
    const contained = { ...node('web', 'ec2'), position: { x: 40, y: 40 }, parentNode: 'manual-vpc', extent: 'parent' as const };
    const laidOut = await applyElkLayeredLayout([manualBox, contained, node('cdn', 'cloudfront')], []);

    const box = laidOut.find((candidate) => candidate.id === 'manual-vpc')!;
    const web = laidOut.find((candidate) => candidate.id === 'web')!;
    expect(box.position).toEqual({ x: 500, y: 500 });
    expect(web.parentNode).toBe('manual-vpc');
    expect(web.position).toEqual({ x: 40, y: 40 });
    expect(laidOut.indexOf(box)).toBeLessThan(laidOut.indexOf(web));
  });

  it('lands every free node on the 24px grid', async () => {
    const nodes = [node('cdn', 'cloudfront'), node('alb', 'alb'), node('app-a', 'ec2')];
    const edges = [edge('e1', 'cdn', 'alb', 'traffic'), edge('e2', 'alb', 'app-a', 'traffic')];
    const laidOut = await applyElkLayeredLayout(nodes, edges);
    for (const candidate of laidOut.filter((n) => n.type === 'awsService')) {
      expect(candidate.position.x % 24).toBe(0);
      expect(candidate.position.y % 24).toBe(0);
    }
  });

  it('produces byte-identical Terraform output — layout only touches position/parentNode, never config', async () => {
    const nodes = [
      node('cdn', 'cloudfront'),
      { ...node('alb', 'alb'), data: { ...node('alb', 'alb').data, config: { load_balancer_type: 'application' } } },
      { ...node('app-a', 'ec2'), data: { ...node('app-a', 'ec2').data, config: { instance_type: 't3.micro' } } },
    ];
    const edges = [edge('e1', 'cdn', 'alb', 'traffic'), edge('e2', 'alb', 'app-a', 'traffic')];

    const before = exportTerraform(nodes, edges);
    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const after = exportTerraform(laidOut, edges);
    expect(after).toBe(before);
  });

  it('DETERMINISM (Fix 3): the same stack built in three different insertion orders produces an identical diagram — full applyElkLayeredLayout pipeline, not just the ordering function in isolation', async () => {
    const catalogue: Record<string, () => AwsNode> = {
      cdn: () => node('cdn', 'cloudfront'),
      alb: () => node('alb', 'alb'),
      'app-a': () => node('app-a', 'ec2'),
      'app-b': () => node('app-b', 'lambda'),
      db: () => node('db', 'rds'),
      logs: () => node('logs', 'cloudwatch'),
    };
    const edgesFor = (): AwsEdge[] => [
      edge('e1', 'cdn', 'alb', 'traffic'),
      edge('e2', 'alb', 'app-a', 'traffic'),
      edge('e3', 'alb', 'app-b', 'traffic'),
      edge('e4', 'app-a', 'db', 'database'),
      edge('e5', 'app-b', 'db', 'database'),
      edge('e6', 'app-a', 'logs', 'metrics'),
    ];
    const build = (order: string[]): AwsNode[] => order.map((id) => catalogue[id]());

    const orderA = build(['cdn', 'alb', 'app-a', 'app-b', 'db', 'logs']);
    const orderB = build(['logs', 'db', 'app-b', 'app-a', 'alb', 'cdn']);
    const orderC = build(['db', 'cdn', 'logs', 'alb', 'app-b', 'app-a']);

    const laidOutA = await applyElkLayeredLayout(orderA, edgesFor());
    const laidOutB = await applyElkLayeredLayout(orderB, edgesFor());
    const laidOutC = await applyElkLayeredLayout(orderC, edgesFor());

    const positionsById = (laidOut: AwsNode[]) =>
      Object.fromEntries(
        laidOut
          .filter((candidate) => candidate.type === 'awsService')
          .map((candidate) => [candidate.id, candidate.position]),
      );

    expect(positionsById(laidOutB)).toEqual(positionsById(laidOutA));
    expect(positionsById(laidOutC)).toEqual(positionsById(laidOutA));
  });
});

function node(id: string, serviceId: string): AwsNode {
  return {
    id,
    type: 'awsService',
    position: { x: 0, y: 0 },
    width: 142,
    height: 92,
    style: { width: 142, height: 92 },
    data: {
      serviceId,
      serviceName: serviceId,
      label: serviceId,
      region: 'us-east-1',
      arn: '',
      status: 'unknown',
      color: '#2563eb',
      icon: 'Box',
      subLabel: '',
      ports: { inputs: ['in'], outputs: ['out'] },
      config: {},
    },
  };
}

function edge(id: string, source: string, target: string, label: string): AwsEdge {
  return {
    id,
    source,
    target,
    type: 'flowEdge',
    data: { label, connectionType: 'data-flow', protocol: 'HTTPS', port: '' },
  };
}

function positionOf(nodes: AwsNode[], id: string): { x: number; y: number } {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node.position;
}

function hasOverlap(nodes: AwsNode[]): boolean {
  return nodes.some((left, leftIndex) =>
    nodes.slice(leftIndex + 1).some((right) => {
      const leftWidth = Number(left.width ?? left.style?.width ?? 142);
      const leftHeight = Number(left.height ?? left.style?.height ?? 92);
      const rightWidth = Number(right.width ?? right.style?.width ?? 142);
      const rightHeight = Number(right.height ?? right.style?.height ?? 92);
      return !(left.position.x + leftWidth <= right.position.x || right.position.x + rightWidth <= left.position.x || left.position.y + leftHeight <= right.position.y || right.position.y + rightHeight <= left.position.y);
    }),
  );
}
