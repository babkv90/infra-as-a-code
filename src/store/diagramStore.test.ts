import { beforeEach, describe, expect, it } from 'vitest';
import type { AwsEdge, AwsNode } from '../types';
import { useDiagramStore } from './diagramStore';

describe('diagramStore — default lens (Fix 4)', () => {
  it('opens on all-connections / full-topology so no infrastructure details are hidden by default', () => {
    const state = useDiagramStore.getState();
    expect(state.activeView).toBe('dependencies');
    expect(state.detailMode).toBe('full-topology');
  });
});

// Regression coverage for the "Findings from 1a implementation" review notes: derivation was only
// ever exercised by calling deriveContainment() directly in isolation. These tests instead go
// through real store mutators, which is the only way to see what applyElkLayeredLayout does to
// manually-drawn boundaries in practice.
describe('diagramStore — manual boundaries vs. derived containment', () => {
  const initialState = useDiagramStore.getState();

  beforeEach(() => {
    useDiagramStore.setState(initialState, true);
  });

  it('a manually-drawn boundary survives a mutator that never touches ELK, even while derivation is actively building other boxes', () => {
    useDiagramStore.setState({
      nodes: [manualVpcBox('manual-box'), node('vpc-1', 'vpc', { x: 0, y: 0 }), node('subnet-1', 'subnet', { x: 400, y: 0 })],
      edges: [resolvesEdge('e1', 'vpc-1', 'subnet-1', 'vpc_id')],
    });

    // addServiceNode never calls applyElkLayeredLayout directly — only importDiagram and autoArrange
    // do synchronously; addServiceNode's own auto-layout (if ff_auto_layout is on) is a separate,
    // later fire-and-forget continuation (triggerAutoLayout), not part of this call.
    useDiagramStore.getState().addServiceNode('s3', { x: 900, y: 0 });

    const nodes = useDiagramStore.getState().nodes;
    expect(nodes.find((n) => n.id === 'manual-box')).toBeDefined();
    // Confirms derivation actually ran (not a vacuous pass with no containers present).
    expect(nodes.some((n) => n.data.derivedContainer)).toBe(true);
  });

  it('FIXED (Fix 2): autoArrange preserves a manually-drawn boundary — was previously dropped because the ELK pass rebuilt its output from service+label nodes only, excluding every groupBox', async () => {
    useDiagramStore.setState({
      nodes: [manualVpcBox('manual-box'), node('ec2-1', 'ec2', { x: 0, y: 0 })],
      edges: [],
    });

    await useDiagramStore.getState().autoArrange();

    const nodes = useDiagramStore.getState().nodes;
    expect(nodes.find((n) => n.id === 'manual-box')).toBeDefined();
    expect(nodes.find((n) => n.id === 'ec2-1')).toBeDefined();
  });

  it('a manually-contained resource keeps its parent-relative position through autoArrange, rather than being re-homed to a fresh absolute position outside its box', async () => {
    const contained = { ...node('ec2-1', 'ec2', { x: 40, y: 40 }), parentNode: 'manual-box', extent: 'parent' as const };
    useDiagramStore.setState({ nodes: [manualVpcBox('manual-box'), contained], edges: [] });

    await useDiagramStore.getState().autoArrange();

    const nodes = useDiagramStore.getState().nodes;
    const ec2 = nodes.find((n) => n.id === 'ec2-1')!;
    expect(ec2.parentNode).toBe('manual-box');
    expect(ec2.position).toEqual({ x: 40, y: 40 });
  });

  it('importDiagram preserves a manually-drawn boundary through its async auto-layout pass, not just the synchronous phase before it', async () => {
    useDiagramStore.getState().importDiagram({
      nodes: [manualVpcBox('manual-box'), node('ec2-1', 'ec2', { x: 0, y: 0 })],
      edges: [],
    });

    const immediateNodes = useDiagramStore.getState().nodes;
    expect(immediateNodes.find((n) => n.id === 'manual-box')).toBeDefined();

    // importDiagram's auto-layout branch resolves the ELK promise asynchronously and then overwrites
    // `nodes` a moment later — wait a tick for that to settle and check the box is still there.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledNodes = useDiagramStore.getState().nodes;
    expect(settledNodes.find((n) => n.id === 'manual-box')).toBeDefined();
  });
});

describe('diagramStore — pinning and the automatic auto-layout trigger', () => {
  const initialState = useDiagramStore.getState();

  beforeEach(() => {
    useDiagramStore.setState(initialState, true);
  });

  it('pinNode marks a node pinned, and autoArrange with no selection clears every pin before laying out', async () => {
    useDiagramStore.setState({
      nodes: [node('alb', 'alb', { x: 0, y: 0 }), node('app', 'ec2', { x: 400, y: 0 })],
      edges: [edge('e1', 'alb', 'app')],
    });

    useDiagramStore.getState().pinNode('alb');
    expect(useDiagramStore.getState().nodes.find((n) => n.id === 'alb')!.data.pinned).toBe(true);

    await useDiagramStore.getState().autoArrange();

    expect(useDiagramStore.getState().nodes.find((n) => n.id === 'alb')!.data.pinned).toBeFalsy();
  });

  it('autoArrange with a selection clears pins only for the selected nodes, leaving others pinned', async () => {
    useDiagramStore.setState({
      nodes: [
        { ...node('alb', 'alb', { x: 0, y: 0 }), selected: true },
        node('app', 'ec2', { x: 400, y: 0 }),
      ],
      edges: [edge('e1', 'alb', 'app')],
    });
    useDiagramStore.getState().pinNode('alb');
    useDiagramStore.getState().pinNode('app');

    await useDiagramStore.getState().autoArrange();

    const nodes = useDiagramStore.getState().nodes;
    expect(nodes.find((n) => n.id === 'alb')!.data.pinned).toBeFalsy();
    expect(nodes.find((n) => n.id === 'app')!.data.pinned).toBe(true);
  });

  it('a pinned node keeps its exact position when a structural mutator adds another node', async () => {
    const pinned = { ...node('db', 'rds', { x: 321, y: 654 }), data: { ...node('db', 'rds', { x: 0, y: 0 }).data, pinned: true } };
    useDiagramStore.setState({ nodes: [node('app', 'ec2', { x: 0, y: 0 }), pinned], edges: [edge('e1', 'app', 'db')] });

    useDiagramStore.getState().addServiceNode('s3', { x: 900, y: 900 });
    // addServiceNode's auto-layout continuation is fire-and-forget — give its promise a tick to settle.
    await tick();

    const db = useDiagramStore.getState().nodes.find((n) => n.id === 'db')!;
    expect(db.position).toEqual({ x: 321, y: 654 });
  });

  it('never triggers auto-layout on a drag — onNodesChange (position updates) produces no further async state change', async () => {
    useDiagramStore.setState({
      nodes: [node('alb', 'alb', { x: 0, y: 0 }), node('app', 'ec2', { x: 400, y: 0 })],
      edges: [edge('e1', 'alb', 'app')],
    });

    useDiagramStore.getState().onNodesChange([{ id: 'alb', type: 'position', position: { x: 48, y: 48 }, dragging: false }]);
    const afterDrag = useDiagramStore.getState().nodes;

    await tick();

    // Referential equality: if any async continuation had fired a further set(), this would be a new
    // array. Drag must never schedule one.
    expect(useDiagramStore.getState().nodes).toBe(afterDrag);
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function manualVpcBox(id: string): AwsNode {
  return {
    id,
    type: 'groupBox',
    position: { x: 0, y: 0 },
    width: 520,
    height: 340,
    style: { width: 520, height: 340 },
    zIndex: -1,
    selectable: true,
    draggable: true,
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
}

function node(id: string, serviceId: string, position: { x: number; y: number }): AwsNode {
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
