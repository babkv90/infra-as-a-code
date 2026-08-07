import type { AwsEdge, AwsNode } from '../types';

export type ConnectionSide = 'left' | 'right' | 'top' | 'bottom';

export interface ConnectionSides {
  sourceSide: ConnectionSide;
  targetSide: ConnectionSide;
}

type NodeLike = Pick<AwsNode, 'position' | 'width' | 'height' | 'style' | 'type'> & {
  data?: Partial<AwsNode['data']>;
};

import { GROUP_NODE_HEIGHT, GROUP_NODE_WIDTH, SERVICE_NODE_HEIGHT, SERVICE_NODE_WIDTH } from './nodeMetrics';

const defaultServiceWidth = SERVICE_NODE_WIDTH;
const defaultServiceHeight = SERVICE_NODE_HEIGHT;
const defaultGroupWidth = GROUP_NODE_WIDTH;
const defaultGroupHeight = GROUP_NODE_HEIGHT;

export function getOptimalConnectionSides(sourceNode: NodeLike, targetNode: NodeLike): ConnectionSides {
  const sourceBounds = getNodeBounds(sourceNode);
  const targetBounds = getNodeBounds(targetNode);
  const sourceCenter = centerOf(sourceBounds);
  const targetCenter = centerOf(targetBounds);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontalGap = dx >= 0 ? targetBounds.x - (sourceBounds.x + sourceBounds.width) : sourceBounds.x - (targetBounds.x + targetBounds.width);
  const verticalGap = dy >= 0 ? targetBounds.y - (sourceBounds.y + sourceBounds.height) : sourceBounds.y - (targetBounds.y + targetBounds.height);

  if (Math.max(horizontalGap, Math.abs(dx)) >= Math.max(verticalGap, Math.abs(dy))) {
    return dx >= 0 ? { sourceSide: 'right', targetSide: 'left' } : { sourceSide: 'left', targetSide: 'right' };
  }

  return dy >= 0 ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
}

/**
 * Handle sides derived from layout direction rather than raw node geometry (Fix 4). With
 * `elk.direction: RIGHT`, a node in an earlier layer connects out its right side into the next
 * layer's left side — deterministic, and stable as nodes move within their layer, unlike geometry
 * which shifts attachment points on every drag. Same-layer pairs (no layer order to derive a
 * direction from) fall back to relative vertical position, matching how a same-column connection
 * already reads in the deterministic layout.
 */
export function getLayerDerivedConnectionSides(sourceLayer: number, targetLayer: number, sourceNode: NodeLike, targetNode: NodeLike): ConnectionSides {
  if (sourceLayer < targetLayer) return { sourceSide: 'right', targetSide: 'left' };
  if (sourceLayer > targetLayer) return { sourceSide: 'left', targetSide: 'right' };
  const sourceCenter = centerOf(getNodeBounds(sourceNode));
  const targetCenter = centerOf(getNodeBounds(targetNode));
  return targetCenter.y >= sourceCenter.y ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
}

export function withOptimalEdgeHandles(edge: AwsEdge, nodesById: Map<string, AwsNode>): AwsEdge {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return edge;

  const sides = getOptimalConnectionSides(sourceNode, targetNode);
  const sourcePort = sourceNode.data.ports.outputs[0];
  const targetPort = targetNode.data.ports.inputs[0];
  return {
    ...edge,
    sourceHandle: sourcePort ? buildHandleId('out', sides.sourceSide, readHandlePort(edge.sourceHandle, sourcePort)) : undefined,
    targetHandle: targetPort ? buildHandleId('in', sides.targetSide, readHandlePort(edge.targetHandle, targetPort)) : undefined,
  };
}

export function buildHandleId(kind: 'in' | 'out', side: ConnectionSide, port = 'default'): string {
  return `${kind}-${side}-${port}`;
}

export function readHandlePort(handleId: string | null | undefined, fallback = 'default'): string {
  if (!handleId) return fallback;
  const parts = handleId.split('-');
  if (parts.length >= 3 && isConnectionSide(parts[1])) return parts.slice(2).join('-') || fallback;
  if (parts.length >= 2) return parts.slice(1).join('-') || fallback;
  return fallback;
}

function getNodeBounds(node: NodeLike): { x: number; y: number; width: number; height: number } {
  const visual = node.data?.visual;
  const fallbackWidth = node.type === 'groupBox' ? defaultGroupWidth : visual?.width ?? defaultServiceWidth;
  const fallbackHeight = node.type === 'groupBox' ? defaultGroupHeight : visual?.height ?? defaultServiceHeight;
  const width = Number(node.width ?? node.style?.width ?? visual?.width ?? fallbackWidth);
  const height = Number(node.height ?? node.style?.height ?? visual?.height ?? fallbackHeight);
  return {
    x: node.position.x,
    y: node.position.y,
    width: Number.isFinite(width) ? width : fallbackWidth,
    height: Number.isFinite(height) ? height : fallbackHeight,
  };
}

function centerOf(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function isConnectionSide(value: string): value is ConnectionSide {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom';
}
