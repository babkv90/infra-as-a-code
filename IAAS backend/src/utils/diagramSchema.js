import { withTopologySemantics } from './topologySemantics.js';

export const CURRENT_DIAGRAM_SCHEMA_VERSION = 1;

export function normalizeDiagramSnapshot(input = {}) {
  const record = isRecord(input) ? input : {};
  const baseNodes = Array.isArray(record.nodes) ? record.nodes.filter(isRecord).map(normalizeNode) : [];
  const nodeById = new Map(baseNodes.map((node) => [node.id, node]));
  const nodes = baseNodes.map((node) => withTopologySemantics(node, node.parentNode ? nodeById.get(node.parentNode) : undefined));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(record.edges)
    ? record.edges
        .filter(isRecord)
        .map(normalizeEdge)
        .filter((edge) => edge && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : [];

  return {
    schemaVersion: CURRENT_DIAGRAM_SCHEMA_VERSION,
    nodes,
    edges,
    ...(typeof record.activeRegion === 'string' ? { activeRegion: record.activeRegion } : {}),
  };
}

export function normalizeDiagramPayload(input = {}, fallback = {}) {
  const snapshot = normalizeDiagramSnapshot({
    nodes: input.nodes ?? fallback.nodes ?? [],
    edges: input.edges ?? fallback.edges ?? [],
    activeRegion: input.activeRegion ?? fallback.activeRegion,
  });

  return {
    ...input,
    schemaVersion: snapshot.schemaVersion,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    activeRegion: snapshot.activeRegion ?? input.activeRegion ?? fallback.activeRegion,
  };
}

function normalizeNode(node, index) {
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
  };
}

function normalizeEdge(edge, index) {
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
  };
}

function isPosition(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
