import type { Node } from 'reactflow';
import type { AwsEdge, AwsNode } from '../types';
import { buildServiceIdLookup, categorizeEdge } from './diagramSemantics';
import { measuredNodeSize } from './nodeMetrics';

// Derivations that used to be recomputed inside every node/edge render. Each one is a pure function
// over the graph so callers can memoise it once per change and share the result, rather than paying
// for it per component per frame.

export type RelationshipBadgeCounts = {
  security: number;
  monitoring: number;
  deployment: number;
};

const emptyBadgeCounts: RelationshipBadgeCounts = { security: 0, monitoring: 0, deployment: 0 };

export function noRelationshipBadges(): RelationshipBadgeCounts {
  return emptyBadgeCounts;
}

/**
 * Secondary-relationship counts per node, keyed by node id. Only nodes with at least one badge get
 * an entry — everything else shares the frozen empty object, so a node with no badges never sees a
 * changed reference.
 */
export function buildRelationshipBadgeCounts(nodes: AwsNode[], edges: AwsEdge[]): Map<string, RelationshipBadgeCounts> {
  const services = buildServiceIdLookup(nodes);
  const counts = new Map<string, RelationshipBadgeCounts>();

  for (const edge of edges) {
    const category = categorizeEdge(edge, services);
    if (category !== 'security' && category !== 'monitoring' && category !== 'deployment') continue;

    for (const nodeId of edge.source === edge.target ? [edge.source] : [edge.source, edge.target]) {
      const current = counts.get(nodeId) ?? { security: 0, monitoring: 0, deployment: 0 };
      current[category] += 1;
      counts.set(nodeId, current);
    }
  }

  return counts;
}

export type ObstacleRect = { id: string; x: number; y: number; width: number; height: number };

/**
 * Rects used for edge-label collision avoidance. Group boxes are excluded — labels are allowed to
 * sit over a boundary, only over another node is a problem.
 */
export function buildObstacleRects(nodes: Node[]): ObstacleRect[] {
  return nodes
    .filter((node) => node.type !== 'groupBox')
    .map((node) => {
      const { width, height } = measuredNodeSize(node);
      return {
        id: node.id,
        x: node.positionAbsolute?.x ?? node.position.x,
        y: node.positionAbsolute?.y ?? node.position.y,
        width,
        height,
      };
    });
}

/**
 * A key covering everything Terraform generation and validation read, and deliberately nothing that
 * only moves pixels. Dragging a node changes `nodes` identity on every pointer tick; without this,
 * memos keyed on `[nodes, edges]` re-run the full export + validation pass every one of those ticks.
 */
export function diagramStructureKey(nodes: AwsNode[], edges: AwsEdge[]): string {
  const nodeKey = nodes
    .map((node) =>
      [
        node.id,
        node.type ?? '',
        node.parentNode ?? '',
        node.data.serviceId ?? '',
        node.data.label,
        node.data.region,
        node.data.arn,
        node.data.status,
        node.data.groupKind ?? '',
        JSON.stringify(node.data.config ?? {}),
        JSON.stringify(node.data.bindings ?? []),
        JSON.stringify(node.data.infrastructure ?? {}),
      ].join(''),
    )
    .join('');

  const edgeKey = edges
    .map((edge) => [edge.id, edge.source, edge.target, JSON.stringify(edge.data ?? {})].join(''))
    .join('');

  return `${nodeKey}${edgeKey}`;
}
