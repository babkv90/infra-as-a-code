import { describe, expect, it } from 'vitest';
import type { AwsNode } from '../types';
import { ensureBoundaryContainment, hasNodeOverlaps, resolveNodeOverlaps } from './resolveNodeOverlaps';

describe('resolveNodeOverlaps', () => {
  it('moves overlapping sibling service nodes apart', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)];
    const resolved = resolveNodeOverlaps(nodes, 'c');

    expect(hasNodeOverlaps(resolved)).toBe(false);
    expect(resolved.find((candidate) => candidate.id === 'a')?.position).toEqual({ x: 0, y: 0 });
    expect(resolved.find((candidate) => candidate.id === 'c')?.position.y).toBeGreaterThan(0);
  });

  it('resolves overlaps independently inside each parent group', () => {
    const group = groupNode('vpc');
    const nodes = [group, node('a', 0, 0, 'vpc'), node('b', 0, 0, 'vpc'), node('outside', 0, 0)];
    const resolved = resolveNodeOverlaps(nodes, 'b');

    expect(hasNodeOverlaps(resolved)).toBe(false);
    expect(resolved.find((candidate) => candidate.id === 'outside')?.position).toEqual({ x: 0, y: 0 });
    expect(resolved.find((candidate) => candidate.id === 'b')?.parentNode).toBe('vpc');
    expect(resolved.find((candidate) => candidate.id === 'b')?.position.y).toBeGreaterThan(0);
  });

  it('grows a boundary when moved children exceed its current size', () => {
    const smallGroup = { ...groupNode('vpc'), width: 260, height: 180, style: { width: 260, height: 180 } };
    const nodes = [smallGroup, node('a', 20, 20, 'vpc'), node('b', 20, 20, 'vpc')];
    const resolved = ensureBoundaryContainment(resolveNodeOverlaps(nodes, 'b'));
    const group = resolved.find((candidate) => candidate.id === 'vpc')!;
    const children = resolved.filter((candidate) => candidate.parentNode === 'vpc');

    for (const child of children) {
      expect(child.position.x).toBeGreaterThanOrEqual(0);
      expect(child.position.y).toBeGreaterThanOrEqual(0);
      expect(child.position.x + Number(child.width)).toBeLessThanOrEqual(Number(group.width));
      expect(child.position.y + Number(child.height)).toBeLessThanOrEqual(Number(group.height));
    }
  });

  it('shifts children with negative relative positions back inside the boundary', () => {
    const nodes = [groupNode('subnet'), node('web', -40, -10, 'subnet')];
    const resolved = ensureBoundaryContainment(nodes);
    const child = resolved.find((candidate) => candidate.id === 'web')!;

    expect(child.position.x).toBeGreaterThanOrEqual(0);
    expect(child.position.y).toBeGreaterThanOrEqual(0);
  });
});

function node(id: string, x: number, y: number, parentNode?: string): AwsNode {
  return {
    id,
    type: 'awsService',
    parentNode,
    position: { x, y },
    width: 218,
    height: 124,
    style: { width: 218, height: 124 },
    data: {
      serviceId: 'ec2',
      serviceName: id,
      label: id,
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

function groupNode(id: string): AwsNode {
  return {
    id,
    type: 'groupBox',
    position: { x: 100, y: 100 },
    width: 520,
    height: 340,
    style: { width: 520, height: 340 },
    data: {
      serviceName: 'VPC',
      label: 'VPC',
      region: 'us-east-1',
      arn: '',
      status: 'unknown',
      color: '#2563eb',
      icon: 'BoxSelect',
      subLabel: '',
      ports: { inputs: [], outputs: [] },
      config: {},
      groupKind: 'VPC',
    },
  };
}
