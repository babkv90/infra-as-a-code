import type { AwsNode } from '../../types';
import { createAbsolutePositionResolver } from '../../utils/topologySemantics';

// Pixels (2D canvas) -> three.js world units. Picked so a default service node (~142x92) reads as
// a small, human-scale block rather than either a speck or something the camera has to be zoomed
// out to the horizon to see the whole diagram.
export const WORLD_SCALE = 1 / 40;
const DEFAULT_SERVICE_WIDTH = 142;
const DEFAULT_SERVICE_HEIGHT = 92;
const DEFAULT_GROUP_WIDTH = 520;
const DEFAULT_GROUP_HEIGHT = 340;

// How far apart (in three.js y) each nesting level sits — containers stack as visibly separate
// raised platforms rather than overlapping flat rectangles, and service nodes stand one level above
// whichever platform they sit on.
export const LAYER_HEIGHT = 0.45;
export const PLATFORM_THICKNESS = 0.08;
export const NODE_BLOCK_HEIGHT = 0.55;

export type Bounds2D = { x: number; y: number; width: number; height: number };

export type ScenePlacement = {
  node: AwsNode;
  /** Center position in three.js world space. */
  worldX: number;
  worldZ: number;
  /** Elevation of the surface this node's block sits on top of. */
  baseY: number;
  worldWidth: number;
  worldDepth: number;
  nestingDepth: number;
};

function defaultSize(node: AwsNode): { width: number; height: number } {
  const isGroup = node.type === 'groupBox';
  const width = Number(node.width ?? node.style?.width ?? node.data.visual?.width ?? (isGroup ? DEFAULT_GROUP_WIDTH : DEFAULT_SERVICE_WIDTH));
  const height = Number(node.height ?? node.style?.height ?? node.data.visual?.height ?? (isGroup ? DEFAULT_GROUP_HEIGHT : DEFAULT_SERVICE_HEIGHT));
  return {
    width: Number.isFinite(width) ? width : isGroup ? DEFAULT_GROUP_WIDTH : DEFAULT_SERVICE_WIDTH,
    height: Number.isFinite(height) ? height : isGroup ? DEFAULT_GROUP_HEIGHT : DEFAULT_SERVICE_HEIGHT,
  };
}

/**
 * Nesting depth is derived from geometry (which boxes visually contain which), not the
 * `parentNode` field — the 2D canvas already treats containment as "does this node's center fall
 * inside that container's bounds" everywhere else (see Canvas.tsx's own group/child hit-testing),
 * and plenty of diagrams never actually set parentNode. Counting how many *larger* group boxes
 * contain a group's center gives the same Region > VPC > Subnet ordering without needing a second,
 * parentNode-based source of truth that could disagree with what's visually drawn.
 */
export function buildScenePlacements(nodes: AwsNode[]): ScenePlacement[] {
  const resolveAbsolute = createAbsolutePositionResolver(nodes);
  const boundsById = new Map<string, Bounds2D>();

  for (const node of nodes) {
    const absolute = resolveAbsolute(node.id);
    const size = defaultSize(node);
    boundsById.set(node.id, { x: absolute.x, y: absolute.y, width: size.width, height: size.height });
  }

  const groups = nodes.filter((node) => node.type === 'groupBox');

  function centerOf(bounds: Bounds2D) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  function containsCenter(container: Bounds2D, point: { x: number; y: number }) {
    return point.x >= container.x && point.x <= container.x + container.width && point.y >= container.y && point.y <= container.y + container.height;
  }

  function depthForGroup(group: AwsNode): number {
    const bounds = boundsById.get(group.id);
    if (!bounds) return 0;
    const center = centerOf(bounds);
    const area = bounds.width * bounds.height;

    let depth = 0;
    for (const other of groups) {
      if (other.id === group.id) continue;
      const otherBounds = boundsById.get(other.id);
      if (!otherBounds) continue;
      const otherArea = otherBounds.width * otherBounds.height;
      if (otherArea > area && containsCenter(otherBounds, center)) depth += 1;
    }
    return depth;
  }

  function depthForService(node: AwsNode): number {
    const bounds = boundsById.get(node.id);
    if (!bounds) return 0;
    const center = centerOf(bounds);

    let maxContainerDepth = -1;
    for (const group of groups) {
      const groupBounds = boundsById.get(group.id);
      if (!groupBounds || !containsCenter(groupBounds, center)) continue;
      maxContainerDepth = Math.max(maxContainerDepth, depthForGroup(group));
    }
    return maxContainerDepth + 1;
  }

  return nodes
    .filter((node) => node.type !== 'labelNode')
    .map((node) => {
      const bounds = boundsById.get(node.id)!;
      const center = centerOf(bounds);
      const nestingDepth = node.type === 'groupBox' ? depthForGroup(node) : depthForService(node);

      return {
        node,
        worldX: center.x * WORLD_SCALE,
        worldZ: center.y * WORLD_SCALE,
        baseY: nestingDepth * LAYER_HEIGHT,
        worldWidth: bounds.width * WORLD_SCALE,
        worldDepth: bounds.height * WORLD_SCALE,
        nestingDepth,
      };
    });
}
