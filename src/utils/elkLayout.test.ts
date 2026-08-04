import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { applyElkLayeredLayout, normalizeSemanticEdges } from './elkLayout';

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
