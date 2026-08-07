import { describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode, EdgeConnectionType } from '../types';
import { buildIsolatedPath, buildVisibleGraph, semanticEdgeCategory, shouldRenderEdge } from './diagramSemantics';

describe('diagram semantics', () => {
  const nodes = [
    node('cdn', 'cloudfront'),
    node('vpc', 'vpc'),
    node('subnet', 'subnet'),
    node('app', 'ec2'),
    node('db', 'rds'),
    node('sg', 'security-group'),
    node('logs', 'cloudwatch'),
  ];

  const edges = [
    edge('traffic-1', 'cdn', 'app', 'traffic', 'data-flow', 'HTTPS'),
    edge('network-1', 'vpc', 'subnet', 'VPC subnet', 'containment', 'VPC'),
    edge('network-2', 'subnet', 'app', 'network', 'network-routing', 'VPC'),
    edge('security-1', 'sg', 'app', 'allow 443', 'security', 'TCP'),
    edge('monitoring-1', 'app', 'logs', 'metrics', 'monitoring', 'CloudWatch'),
    edge('data-1', 'app', 'db', 'database', 'data-flow', 'Postgres'),
  ];

  it('classifies legacy and semantic relationships', () => {
    expect(semanticEdgeCategory(edges[0], nodes)).toBe('data-flow');
    expect(semanticEdgeCategory(edge('legacy', 'vpc', 'subnet', 'inside subnet', 'data', 'VPC'), nodes)).toBe('containment');
    expect(semanticEdgeCategory(edge('ref', 'app', 'db', 'reference', 'data', 'Terraform'), nodes)).toBe('dependency');
  });

  it('hides containment and secondary edges from the default application flow', () => {
    const visible = edges.filter((candidate) => shouldRenderEdge(candidate, nodes, 'application-flow', 'architecture')).map((candidate) => candidate.id);
    expect(visible).toContain('traffic-1');
    expect(visible).toContain('data-1');
    expect(visible).not.toContain('network-1');
    expect(visible).not.toContain('security-1');
    expect(visible).not.toContain('monitoring-1');
  });

  it('never draws containment edges, including in full topology — containment is nesting now (Fix 1/4), not a line', () => {
    const visible = edges.filter((candidate) => shouldRenderEdge(candidate, nodes, 'dependencies', 'full-topology')).map((candidate) => candidate.id);
    expect(visible).not.toContain('network-1');
  });

  it('still hides containment edges outside full topology, e.g. the default application flow', () => {
    const visible = edges.filter((candidate) => shouldRenderEdge(candidate, nodes, 'application-flow', 'full-topology')).map((candidate) => candidate.id);
    expect(visible).not.toContain('network-1');
  });

  it('isolates upstream and downstream dependency paths', () => {
    const isolated = buildIsolatedPath('app', nodes, edges);
    expect(Array.from(isolated.nodeIds).sort()).toEqual(['app', 'cdn', 'db', 'logs', 'sg', 'subnet'].sort());
    expect(isolated.edgeIds.has('network-1')).toBe(false);
  });

  it('does not leave endpointless nodes visible in filtered views', () => {
    const visible = buildVisibleGraph(nodes, edges, 'application-flow', 'architecture');
    expect(visible.edges.map((candidate) => candidate.id).sort()).toEqual(['data-1', 'traffic-1'].sort());
    expect(visible.nodes.map((candidate) => candidate.id).sort()).toEqual(['app', 'cdn', 'db'].sort());
  });
});

function node(id: string, serviceId: string): AwsNode {
  return {
    id,
    type: 'awsService',
    position: { x: 0, y: 0 },
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

function edge(id: string, source: string, target: string, label: string, connectionType: EdgeConnectionType, protocol: string): AwsEdge {
  return {
    id,
    source,
    target,
    type: 'flowEdge',
    data: { label, connectionType, protocol, port: '' },
  };
}
