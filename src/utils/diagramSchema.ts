import type { AwsEdge, AwsNode, DiagramSnapshot } from '../types';
import { withTopologySemantics } from './topologySemantics';

export const CURRENT_DIAGRAM_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

export type NormalizedDiagramSnapshot = DiagramSnapshot & {
  schemaVersion: typeof CURRENT_DIAGRAM_SCHEMA_VERSION;
  activeRegion?: string;
};

export function normalizeDiagramSnapshot(input: unknown): NormalizedDiagramSnapshot {
  const record = isRecord(input) ? input : {};
  const baseNodes = Array.isArray(record.nodes) ? record.nodes.filter(isRecord).map(normalizeNode) : [];
  const nodeById = new Map(baseNodes.map((node) => [node.id, node]));
  const nodes = baseNodes.map((node) => withTopologySemantics(node, node.parentNode ? nodeById.get(node.parentNode) : undefined));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(record.edges)
    ? record.edges
        .filter(isRecord)
        .map(normalizeEdge)
        .filter((edge): edge is AwsEdge => Boolean(edge && nodeIds.has(edge.source) && nodeIds.has(edge.target)))
    : [];
  const activeRegion = typeof record.activeRegion === 'string' ? record.activeRegion : undefined;

  return {
    schemaVersion: CURRENT_DIAGRAM_SCHEMA_VERSION,
    nodes,
    edges,
    ...(activeRegion ? { activeRegion } : {}),
  };
}

function normalizeNode(node: UnknownRecord, index: number): AwsNode {
  const data = isRecord(node.data) ? node.data : {};
  const config = isRecord(data.config) ? data.config : {};
  const id = typeof node.id === 'string' && node.id.trim() ? node.id : `node-${index}`;
  const type = typeof node.type === 'string' && node.type.trim() ? node.type : data.serviceId ? 'awsService' : 'default';
  const position = isPosition(node.position) ? node.position : { x: 0, y: 0 };

  return {
    ...node,
    id,
    type,
    position,
    data: {
      ...data,
      config,
    },
  } as AwsNode;
}

function normalizeEdge(edge: UnknownRecord, index: number): AwsEdge | undefined {
  if (typeof edge.source !== 'string' || typeof edge.target !== 'string') return undefined;

  return {
    ...edge,
    id: typeof edge.id === 'string' && edge.id.trim() ? edge.id : `edge-${index}`,
    source: edge.source,
    target: edge.target,
    type: typeof edge.type === 'string' && edge.type.trim() ? edge.type : 'flowEdge',
    data: isRecord(edge.data)
      ? edge.data
      : {
          label: 'data',
          connectionType: 'data',
          protocol: 'HTTPS',
          port: '443',
        },
  } as AwsEdge;
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
