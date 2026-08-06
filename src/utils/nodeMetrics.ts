// Single source of truth for canvas node geometry.
//
// These numbers were previously copy-pasted as literals across connectionRouting, diagramSemantics,
// elkLayout, graphIndex and Canvas — so changing the node design meant finding every one of them,
// and missing one produced layout that was subtly wrong rather than obviously broken.
//
// Anything that measures, lays out, or hit-tests a node reads from here. Keep in step with the
// `.aws-node` / `.aws-node--card` rules in styles.css.

/**
 * Footprint of a service node: icon + name + terraform type + two config lines + readiness footer.
 *
 * Every lens shares this footprint, including the compact whiteboard/architecture renderings, which
 * centre a smaller tile inside it. That is deliberate — auto-layout writes these dimensions onto the
 * node, so a lens that drew itself narrower would leave its connection handles sitting away from the
 * visible shape.
 */
export const SERVICE_NODE_WIDTH = 218;
export const SERVICE_NODE_HEIGHT = 124;

export const GROUP_NODE_WIDTH = 520;
export const GROUP_NODE_HEIGHT = 340;

export const LABEL_NODE_WIDTH = 180;
export const LABEL_NODE_HEIGHT = 80;

type SizedNode = {
  type?: string;
  width?: number | null;
  height?: number | null;
  style?: { width?: string | number; height?: string | number };
  data?: { visual?: { width?: number; height?: number } };
};

export function defaultSizeForNodeType(type?: string): { width: number; height: number } {
  if (type === 'groupBox') return { width: GROUP_NODE_WIDTH, height: GROUP_NODE_HEIGHT };
  if (type === 'labelNode') return { width: LABEL_NODE_WIDTH, height: LABEL_NODE_HEIGHT };
  return { width: SERVICE_NODE_WIDTH, height: SERVICE_NODE_HEIGHT };
}

/**
 * Measured size where React Flow has one, falling back through the node's own saved visual state to
 * the type default. Callers used to inline this chain with differing fallbacks, so the same node
 * could measure 142x92 in one place and 150x90 in another.
 */
export function measuredNodeSize(node: SizedNode): { width: number; height: number } {
  const fallback = defaultSizeForNodeType(node.type);
  const width = Number(node.width ?? node.style?.width ?? node.data?.visual?.width ?? fallback.width);
  const height = Number(node.height ?? node.style?.height ?? node.data?.visual?.height ?? fallback.height);
  return {
    width: Number.isFinite(width) ? width : fallback.width,
    height: Number.isFinite(height) ? height : fallback.height,
  };
}
