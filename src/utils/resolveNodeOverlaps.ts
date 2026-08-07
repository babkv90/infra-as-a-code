import type { AwsNode } from '../types';
import { measuredNodeSize } from './nodeMetrics';
import { withTopologySemantics } from './topologySemantics';

const GRID = 24;
const GAP = 24;
const BOUNDARY_PADDING = 24;
const MAX_ATTEMPTS = 240;

type Rect = { id: string; x: number; y: number; width: number; height: number };

export function resolveNodeOverlaps(nodes: AwsNode[], preferredNodeId?: string): AwsNode[] {
  const resolvedById = new Map<string, AwsNode>();
  const groups = groupMovableNodesByParent(nodes);

  for (const [parentId, siblings] of groups.entries()) {
    const placed: Rect[] = [];
    const ordered = [...siblings].sort((left, right) => {
      if (left.id === preferredNodeId) return 1;
      if (right.id === preferredNodeId) return -1;
      return left.position.x - right.position.x || left.position.y - right.position.y || left.id.localeCompare(right.id);
    });

    for (const node of ordered) {
      const size = measuredNodeSize(node);
      const position = findOpenPosition(
        {
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          width: size.width,
          height: size.height,
        },
        placed,
      );
      const nextNode = withTopologySemantics({
        ...node,
        position,
        width: size.width,
        height: size.height,
        style: { ...node.style, width: size.width, height: size.height },
      }, parentId ? nodes.find((candidate) => candidate.id === parentId) : undefined);
      resolvedById.set(node.id, nextNode);
      placed.push({ id: node.id, ...position, width: size.width, height: size.height });
    }
  }

  return nodes.map((node) => resolvedById.get(node.id) ?? node);
}

export function ensureBoundaryContainment(nodes: AwsNode[]): AwsNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, AwsNode[]>();
  for (const node of nodes) {
    if (!node.parentNode || isDecorativeGroup(node)) continue;
    childrenByParent.set(node.parentNode, [...(childrenByParent.get(node.parentNode) ?? []), node]);
  }

  const mutable = new Map(nodes.map((node) => [node.id, node]));
  const groups = nodes
    .filter((node) => node.type === 'groupBox' && !isDecorativeGroup(node))
    .sort((left, right) => parentDepth(right, byId) - parentDepth(left, byId));

  for (const group of groups) {
    const latestGroup = mutable.get(group.id) ?? group;
    const children = (childrenByParent.get(group.id) ?? [])
      .map((child) => mutable.get(child.id) ?? child)
      .filter((child) => !isDecorativeGroup(child));
    if (!children.length) continue;

    const childRects = children.map((child) => ({ node: child, ...child.position, ...measuredNodeSize(child) }));
    const minX = Math.min(...childRects.map((rect) => rect.x));
    const minY = Math.min(...childRects.map((rect) => rect.y));
    const shiftX = Math.max(0, BOUNDARY_PADDING - minX);
    const shiftY = Math.max(0, BOUNDARY_PADDING - minY);

    if (shiftX || shiftY) {
      for (const child of children) {
        mutable.set(child.id, withGeometry(child, { x: child.position.x + shiftX, y: child.position.y + shiftY }));
      }
    }

    const shiftedRects = children.map((child) => {
      const shifted = mutable.get(child.id) ?? child;
      return { ...shifted.position, ...measuredNodeSize(shifted) };
    });
    const maxX = Math.max(...shiftedRects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...shiftedRects.map((rect) => rect.y + rect.height));
    const currentSize = measuredNodeSize(latestGroup);
    const nextWidth = Math.max(currentSize.width, maxX + BOUNDARY_PADDING);
    const nextHeight = Math.max(currentSize.height, maxY + BOUNDARY_PADDING);

    if (nextWidth !== currentSize.width || nextHeight !== currentSize.height) {
      mutable.set(group.id, withGeometry(latestGroup, latestGroup.position, { width: nextWidth, height: nextHeight }));
    }
  }

  return nodes.map((node) => mutable.get(node.id) ?? node);
}

export function hasNodeOverlaps(nodes: AwsNode[]): boolean {
  for (const siblings of groupMovableNodesByParent(nodes).values()) {
    const rects = siblings.map((node) => {
      const size = measuredNodeSize(node);
      return { id: node.id, x: node.position.x, y: node.position.y, width: size.width, height: size.height };
    });
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        if (rectsOverlap(rects[leftIndex], rects[rightIndex], 0)) return true;
      }
    }
  }
  return false;
}

function groupMovableNodesByParent(nodes: AwsNode[]): Map<string, AwsNode[]> {
  const groups = new Map<string, AwsNode[]>();
  for (const node of nodes) {
    if (node.type === 'groupBox') continue;
    const parentKey = node.parentNode ?? '';
    groups.set(parentKey, [...(groups.get(parentKey) ?? []), node]);
  }
  return groups;
}

function isDecorativeGroup(node: AwsNode): boolean {
  return node.type === 'groupBox' && node.data.config?.generated_group === 'true';
}

function findOpenPosition(rect: Rect, placed: Rect[]): { x: number; y: number } {
  let candidate = { x: rect.x, y: rect.y };
  let attempts = 0;

  while (placed.some((other) => rectsOverlap({ ...rect, ...candidate }, other, GAP)) && attempts < MAX_ATTEMPTS) {
    const colliders = placed.filter((other) => rectsOverlap({ ...rect, ...candidate }, other, GAP));
    const nextY = Math.max(...colliders.map((other) => other.y + other.height + GAP));
    candidate = { x: rect.x, y: snap(nextY) };
    attempts += 1;
  }

  return candidate;
}

function rectsOverlap(left: Rect, right: Rect, gap: number): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function parentDepth(node: AwsNode, byId: Map<string, AwsNode>): number {
  let depth = 0;
  let current = node.parentNode ? byId.get(node.parentNode) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = current.parentNode ? byId.get(current.parentNode) : undefined;
  }
  return depth;
}

function withGeometry(node: AwsNode, position: { x: number; y: number }, size = measuredNodeSize(node)): AwsNode {
  return {
    ...node,
    position,
    width: size.width,
    height: size.height,
    style: { ...node.style, width: size.width, height: size.height },
    data: {
      ...node.data,
      visual: {
        ...node.data.visual,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      },
    },
  };
}
