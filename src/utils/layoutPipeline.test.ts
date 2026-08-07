import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { applyElkLayeredLayout, normalizeSemanticEdges } from './elkLayout';
import { deriveContainment } from './deriveContainment';
import { createAbsolutePositionResolver } from './topologySemantics';

// The real store pipeline (diagramStore.ts) always runs applyElkLayeredLayout then
// deriveContainment on its output — these tests exercise that exact sequence, since the bug
// reports ("nodes overlapping, boundaries too") only showed up with the two combined, never in
// either function's own isolated unit tests.
describe('layout pipeline (applyElkLayeredLayout -> deriveContainment)', () => {
  it('two fully disconnected VPCs (zero edges anywhere between or to them) never overlap', async () => {
    // No ingress, no traffic edges at all connecting vpc-a's cluster to vpc-b's — ELK treats these as
    // genuinely separate connected components, spaced via elk.spacing.componentComponent rather than
    // the ordinary node-node/layer spacing used within one connected graph.
    const nodes = [
      node('vpc-a', 'vpc'),
      node('subnet-a', 'subnet'),
      node('ec2-a1', 'ec2'),
      node('vpc-b', 'vpc'),
      node('subnet-b', 'subnet'),
      node('ec2-b1', 'ec2'),
    ];
    const edges = normalizeSemanticEdges(
      [
        resolvesEdge('e1', 'vpc-a', 'subnet-a', 'vpc_id'),
        resolvesEdge('e2', 'subnet-a', 'ec2-a1', 'subnet_id'),
        resolvesEdge('e3', 'vpc-b', 'subnet-b', 'vpc_id'),
        resolvesEdge('e4', 'subnet-b', 'ec2-b1', 'subnet_id'),
      ],
      nodes,
    );

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const result = deriveContainment(laidOut, edges);
    const withoutSemanticColumns = result.filter((candidate) => candidate.data.config?.generated_group !== 'true');
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const rects = withoutSemanticColumns.map((candidate) => ({
      id: candidate.id,
      ...resolveAbsolute(candidate.id),
      width: Number(candidate.width ?? candidate.style?.width ?? 218),
      height: Number(candidate.height ?? candidate.style?.height ?? 124),
      isAncestorOf: (otherId: string) => isAncestor(result, candidate.id, otherId),
    }));

    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.isAncestorOf(b.id) || b.isAncestorOf(a.id)) continue;
        if (rectsOverlap(a, b)) overlaps.push(`${a.id} <-> ${b.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('a pinned node never gets overlapped by freshly-laid-out content added afterward', async () => {
    const pinnedBase = node('kept-in-place', 'ec2');
    const pinned = { ...pinnedBase, position: { x: 60, y: 60 }, data: { ...pinnedBase.data, pinned: true } };
    const nodes = [pinned, node('vpc-a', 'vpc'), node('subnet-a', 'subnet'), node('ec2-a1', 'ec2'), node('rds-a1', 'rds')];
    const edges = normalizeSemanticEdges(
      [resolvesEdge('e1', 'vpc-a', 'subnet-a', 'vpc_id'), resolvesEdge('e2', 'subnet-a', 'ec2-a1', 'subnet_id'), resolvesEdge('e3', 'subnet-a', 'rds-a1', 'subnet_id')],
      nodes,
    );

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const result = deriveContainment(laidOut, edges);
    const withoutSemanticColumns = result.filter((candidate) => candidate.data.config?.generated_group !== 'true');
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const pinnedResult = withoutSemanticColumns.find((candidate) => candidate.id === 'kept-in-place')!;
    expect(resolveAbsolute('kept-in-place')).toEqual({ x: 60, y: 60 });

    const rects = withoutSemanticColumns.map((candidate) => ({
      id: candidate.id,
      ...resolveAbsolute(candidate.id),
      width: Number(candidate.width ?? candidate.style?.width ?? 218),
      height: Number(candidate.height ?? candidate.style?.height ?? 124),
      isAncestorOf: (otherId: string) => isAncestor(result, candidate.id, otherId),
    }));
    const overlaps: string[] = [];
    for (const other of rects) {
      if (other.id === pinnedResult.id) continue;
      if (other.isAncestorOf(pinnedResult.id) || rects.find((r) => r.id === pinnedResult.id)!.isAncestorOf(other.id)) continue;
      if (rectsOverlap({ ...resolveAbsolute('kept-in-place'), width: 218, height: 124 }, other)) overlaps.push(other.id);
    }
    expect(overlaps).toEqual([]);
  });

  it('two unrelated VPCs and an external resource never overlap — cards or boxes', async () => {
    const nodes = [
      node('vpc-a', 'vpc'),
      node('subnet-a', 'subnet'),
      node('ec2-a1', 'ec2'),
      node('ec2-a2', 'ec2'),
      node('vpc-b', 'vpc'),
      node('subnet-b', 'subnet'),
      node('ec2-b1', 'ec2'),
      node('rds-b1', 'rds'),
      node('bucket', 's3'),
      node('alb', 'alb'),
    ];
    const edges = normalizeSemanticEdges(
      [
        resolvesEdge('e1', 'vpc-a', 'subnet-a', 'vpc_id'),
        resolvesEdge('e2', 'subnet-a', 'ec2-a1', 'subnet_id'),
        resolvesEdge('e3', 'subnet-a', 'ec2-a2', 'subnet_id'),
        resolvesEdge('e4', 'vpc-b', 'subnet-b', 'vpc_id'),
        resolvesEdge('e5', 'subnet-b', 'ec2-b1', 'subnet_id'),
        resolvesEdge('e6', 'subnet-b', 'rds-b1', 'subnet_id'),
        edge('e7', 'alb', 'ec2-a1'),
        edge('e8', 'alb', 'ec2-b1'),
      ],
      nodes,
    );

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const result = deriveContainment(laidOut, edges);

    // Semantic-column boxes (Architecture View's lane display) are a separate, pre-existing,
    // purely positional grouping — they wrap their members without a real parentNode link, unlike
    // derived/manual containment, so they aren't part of what this test is checking.
    const withoutSemanticColumns = result.filter((candidate) => candidate.data.config?.generated_group !== 'true');
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const rects = withoutSemanticColumns.map((candidate) => ({
      id: candidate.id,
      ...resolveAbsolute(candidate.id),
      width: Number(candidate.width ?? candidate.style?.width ?? 218),
      height: Number(candidate.height ?? candidate.style?.height ?? 124),
      isAncestorOf: (otherId: string) => isAncestor(result, candidate.id, otherId),
    }));

    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        // A box and its own descendant are *supposed* to overlap (that's containment) — only flag
        // overlap between elements with no ancestor relationship to each other.
        if (a.isAncestorOf(b.id) || b.isAncestorOf(a.id)) continue;
        if (rectsOverlap(a, b)) overlaps.push(`${a.id} <-> ${b.id}`);
      }
    }

    expect(overlaps).toEqual([]);
  });

  it('does not overlap at a larger scale — 4 VPCs with multiple subnets each, plus a spread of external services', async () => {
    const nodes: AwsNode[] = [];
    const edges: AwsEdge[] = [];
    let edgeSeq = 0;
    const nextEdgeId = () => `e${edgeSeq++}`;

    for (let v = 0; v < 4; v += 1) {
      const vpcId = `vpc-${v}`;
      nodes.push(node(vpcId, 'vpc'));
      for (let s = 0; s < 2; s += 1) {
        const subnetId = `${vpcId}-subnet-${s}`;
        nodes.push(node(subnetId, 'subnet'));
        edges.push(resolvesEdge(nextEdgeId(), vpcId, subnetId, 'vpc_id'));
        for (let r = 0; r < 3; r += 1) {
          const resourceId = `${subnetId}-r${r}`;
          nodes.push(node(resourceId, r === 0 ? 'ec2' : r === 1 ? 'rds' : 'lambda'));
          edges.push(resolvesEdge(nextEdgeId(), subnetId, resourceId, 'subnet_id'));
        }
      }
    }
    const externalServiceIds = ['s3', 'dynamodb', 'sns', 'sqs', 'iam', 'cloudwatch', 'route53', 'cloudfront'];
    for (const [index, serviceId] of externalServiceIds.entries()) {
      nodes.push(node(`external-${index}`, serviceId));
    }
    nodes.push(node('alb-0', 'alb'), node('alb-1', 'alb'));
    edges.push(edge(nextEdgeId(), 'alb-0', 'vpc-0-subnet-0-r0'), edge(nextEdgeId(), 'alb-1', 'vpc-2-subnet-0-r0'));

    const normalizedEdges = normalizeSemanticEdges(edges, nodes);
    const laidOut = await applyElkLayeredLayout(nodes, normalizedEdges);
    const result = deriveContainment(laidOut, normalizedEdges);

    const withoutSemanticColumns = result.filter((candidate) => candidate.data.config?.generated_group !== 'true');
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const rects = withoutSemanticColumns.map((candidate) => ({
      id: candidate.id,
      ...resolveAbsolute(candidate.id),
      width: Number(candidate.width ?? candidate.style?.width ?? 218),
      height: Number(candidate.height ?? candidate.style?.height ?? 124),
      isAncestorOf: (otherId: string) => isAncestor(result, candidate.id, otherId),
    }));

    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.isAncestorOf(b.id) || b.isAncestorOf(a.id)) continue;
        if (rectsOverlap(a, b)) overlaps.push(`${a.id} <-> ${b.id}`);
      }
    }

    expect(overlaps).toEqual([]);
    expect(nodes.length).toBeGreaterThan(40); // sanity check the fixture is actually a stress test
  });

  it('every derived box actually encloses everything nested inside it, at every depth', async () => {
    const nodes = [node('vpc-a', 'vpc'), node('subnet-a', 'subnet'), node('ec2-a1', 'ec2'), node('ec2-a2', 'ec2'), node('bucket', 's3')];
    const edges = normalizeSemanticEdges(
      [
        resolvesEdge('e1', 'vpc-a', 'subnet-a', 'vpc_id'),
        resolvesEdge('e2', 'subnet-a', 'ec2-a1', 'subnet_id'),
        resolvesEdge('e3', 'subnet-a', 'ec2-a2', 'subnet_id'),
      ],
      nodes,
    );

    const laidOut = await applyElkLayeredLayout(nodes, edges);
    const result = deriveContainment(laidOut, edges);
    const resolveAbsolute = createAbsolutePositionResolver(result);
    const byId = new Map(result.map((candidate) => [candidate.id, candidate]));

    for (const candidate of result) {
      if (!candidate.parentNode) continue;
      const parent = byId.get(candidate.parentNode);
      if (!parent) continue;
      const childAbs = resolveAbsolute(candidate.id);
      const parentAbs = resolveAbsolute(parent.id);
      const childWidth = Number(candidate.width ?? candidate.style?.width ?? 218);
      const childHeight = Number(candidate.height ?? candidate.style?.height ?? 124);
      const parentWidth = Number(parent.width ?? parent.style?.width ?? 520);
      const parentHeight = Number(parent.height ?? parent.style?.height ?? 340);

      expect(childAbs.x).toBeGreaterThanOrEqual(parentAbs.x - 1);
      expect(childAbs.y).toBeGreaterThanOrEqual(parentAbs.y - 1);
      expect(childAbs.x + childWidth).toBeLessThanOrEqual(parentAbs.x + parentWidth + 1);
      expect(childAbs.y + childHeight).toBeLessThanOrEqual(parentAbs.y + parentHeight + 1);
    }
  });
});

function isAncestor(nodes: AwsNode[], ancestorId: string, nodeId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current?.parentNode && !seen.has(current.parentNode)) {
    if (current.parentNode === ancestorId) return true;
    seen.add(current.parentNode);
    current = byId.get(current.parentNode);
  }
  return false;
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function node(id: string, serviceId: string): AwsNode {
  return {
    id,
    type: 'awsService',
    position: { x: 0, y: 0 },
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
      config: {},
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

function edge(id: string, source: string, target: string): AwsEdge {
  return { id, source, target, type: 'flowEdge', data: { label: 'traffic', connectionType: 'data-flow', protocol: 'HTTPS', port: '' } };
}
