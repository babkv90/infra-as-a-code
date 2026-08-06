import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from 'reactflow';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsEdgeData } from '../../types';
import { useEdgeGeometry } from '../canvasGraphContext';
import type { ObstacleRect } from '../../utils/graphIndex';

const edgeColors = {
  data: '#2563eb',
  event: '#f97316',
  'data-flow': '#2563eb',
  'network-routing': '#0ea5e9',
  security: '#dc2626',
  containment: '#64748b',
  dependency: '#7c3aed',
  monitoring: '#64748b',
  deployment: '#16a34a',
};

const whiteboardEdgeColors = {
  data: '#111111',
  event: '#111111',
  'data-flow': '#111111',
  'network-routing': '#111111',
  security: '#3B5FA8',
  containment: '#9ca3af',
  dependency: '#3B5FA8',
  monitoring: '#3B5FA8',
  deployment: '#111111',
};

// Matches the Architecture view's own legend: solid light line for the main application flow,
// dashed/dotted per category otherwise — always shown at full color (not just on selection), since
// this view's whole point is reading the relationship types across the diagram at a glance.
const architectureEdgeColors = {
  data: '#cbd5e1',
  event: '#f97316',
  'data-flow': '#cbd5e1',
  'network-routing': '#22d3ee',
  security: '#f87171',
  containment: '#475569',
  dependency: '#a78bfa',
  monitoring: '#60a5fa',
  deployment: '#34d399',
};

function architectureDasharray(category: keyof typeof architectureEdgeColors): string | undefined {
  if (category === 'network-routing') return '10 6';
  if (category === 'security') return '2 5';
  if (category === 'dependency') return '8 5';
  if (category === 'monitoring') return '2 6';
  return undefined;
}

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<AwsEdgeData>) {
  const [isHovered, setIsHovered] = useState(false);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const geometry = useEdgeGeometry();
  const [edgePath, rawLabelX, rawLabelY] = getBundledSmoothPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    bundleIndex: data?.bundleIndex,
    bundleSize: data?.bundleSize,
  });
  const connectionType = data?.semanticCategory ?? data?.connectionType ?? 'data-flow';
  const typeColor = architectureViewMode ? architectureEdgeColors[connectionType] : (whiteboardMode ? whiteboardEdgeColors : edgeColors)[connectionType];
  const color = whiteboardMode || architectureViewMode ? typeColor : selected || data?.highlighted ? typeColor : '#8b9097';
  // Imported diagrams carry a lot of auto-generated "reference"/Terraform edges whose label says
  // nothing; those stay mute. A reference a user deliberately drew is different — the label is the
  // only thing distinguishing it from a modelled relationship, so it must show.
  const isDeclaredRelationship = Boolean(data?.relationshipKind);
  const isGenericReference = !isDeclaredRelationship && data?.label === 'reference' && data?.protocol === 'Terraform';
  const label = data?.hiddenCount ? `${data.label} +${data.hiddenCount}` : data?.label;
  const showLabel = Boolean(label && !isGenericReference && (selected || isHovered || data?.highlighted));
  const showFlowDots = !whiteboardMode && !architectureViewMode && (selected || data?.highlighted) && (connectionType === 'data-flow' || connectionType === 'event');
  // Only the handful of edges actually showing a label pay for collision avoidance. This used to run
  // for every edge on every render — including the ones whose label was hidden — and each run
  // rebuilt an obstacle rect for every node in the graph.
  const labelPosition = showLabel
    ? avoidLabelOverlap(
        { x: rawLabelX, y: rawLabelY },
        geometry.getObstacles().filter((rect) => rect.id !== source && rect.id !== target),
        labelOffsetForEdge(id),
      )
    : { x: rawLabelX, y: rawLabelY };
  const strokeDasharray = architectureViewMode
    ? architectureDasharray(connectionType)
    : whiteboardMode
      ? undefined
      : connectionType === 'security'
        ? '7 6'
        : connectionType === 'monitoring' || connectionType === 'dependency' || connectionType === 'deployment'
          ? '4 6'
          : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          ...style,
          stroke: color,
          strokeWidth: whiteboardMode ? 1.4 : architectureViewMode ? 2 : selected || data?.highlighted ? 2.6 : 1.8,
          strokeDasharray,
          filter: !whiteboardMode && selected ? `drop-shadow(0 0 7px ${typeColor}66)` : undefined,
        }}
      />
      <path className="edge-hover-target" d={edgePath} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} />
      {showFlowDots && <path className="flow-dots" d={edgePath} style={{ stroke: color }} />}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label edge-label--${connectionType} ${selected ? 'edge-label--selected' : ''} ${whiteboardMode ? 'edge-label--whiteboard' : ''} ${architectureViewMode ? 'edge-label--architecture' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function labelOffsetForEdge(id: string): { x: number; y: number } {
  const offsets = [-22, -11, 0, 11, 22];
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 997;
  }
  return { x: 0, y: offsets[hash % offsets.length] };
}

// Below this gap, a bezier control offset would overshoot the actual distance between the two
// nodes and bulge into a visible loop — close nodes read far better as a direct line.
const STRAIGHT_LINE_DISTANCE = 200;

function getBundledSmoothPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  bundleIndex = 0,
  bundleSize = 1,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'> & { bundleIndex?: number; bundleSize?: number }): [string, number, number] {
  const straightDistance = Math.hypot(targetX - sourceX, targetY - sourceY);
  const bundleOffset = (bundleIndex - (bundleSize - 1) / 2) * 14;
  const length = straightDistance || 1;
  const perpX = (-(targetY - sourceY) / length) * bundleOffset;
  const perpY = ((targetX - sourceX) / length) * bundleOffset;
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  if (straightDistance < STRAIGHT_LINE_DISTANCE) {
    // No bundling needed: a plain straight line. Bundled (multiple edges sharing an endpoint):
    // nudge the midpoint sideways per bundle slot so parallel edges fan out instead of overlapping.
    if (bundleOffset === 0) {
      return [`M ${sourceX},${sourceY} L ${targetX},${targetY}`, midX, midY];
    }
    return [`M ${sourceX},${sourceY} Q ${midX + perpX},${midY + perpY} ${targetX},${targetY}`, midX + perpX, midY + perpY];
  }

  // Longer edges: a single smooth cubic bezier that leaves/arrives along each node's facing side.
  // Never a boxy right-angle detour — a stepped lead/junction path reads as broken/disconnected the
  // moment the two nodes aren't perfectly aligned, even when every point is mathematically correct.
  const sourceVector = sideVector(String(sourcePosition));
  const targetVector = sideVector(String(targetPosition));
  const controlDistance = Math.min(Math.max(straightDistance * 0.38, 40), 220);
  const c1x = sourceX + sourceVector.x * controlDistance + perpX;
  const c1y = sourceY + sourceVector.y * controlDistance + perpY;
  const c2x = targetX + targetVector.x * controlDistance + perpX;
  const c2y = targetY + targetVector.y * controlDistance + perpY;
  const label = cubicPoint(0.5, { x: sourceX, y: sourceY }, { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x: targetX, y: targetY });

  return [`M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`, label.x, label.y];
}

function avoidLabelOverlap(base: Point, obstacles: ObstacleRect[], hashOffset: Point): Point {
  const candidates = [
    hashOffset,
    { x: hashOffset.x, y: hashOffset.y - 44 },
    { x: hashOffset.x, y: hashOffset.y + 44 },
    { x: hashOffset.x + 92, y: hashOffset.y },
    { x: hashOffset.x - 92, y: hashOffset.y },
    { x: hashOffset.x + 92, y: hashOffset.y - 44 },
    { x: hashOffset.x - 92, y: hashOffset.y + 44 },
  ];
  const labelSize = { width: 176, height: 42 };
  const match = candidates.find((offset) => !obstacles.some((rect) => rectsOverlap(labelRect({ x: base.x + offset.x, y: base.y + offset.y }, labelSize), expandRect(rect, 10))));
  const offset = match ?? candidates[candidates.length - 1];
  return { x: base.x + offset.x, y: base.y + offset.y };
}

function labelRect(center: Point, size: { width: number; height: number }): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return !(left.x + left.width < right.x || right.x + right.width < left.x || left.y + left.height < right.y || right.y + right.height < left.y);
}

function expandRect(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

function sideVector(position: string): { x: number; y: number } {
  if (position === 'left') return { x: -1, y: 0 };
  if (position === 'right') return { x: 1, y: 0 };
  if (position === 'top') return { x: 0, y: -1 };
  if (position === 'bottom') return { x: 0, y: 1 };
  return { x: 1, y: 0 };
}

function cubicPoint(t: number, start: Point, controlA: Point, controlB: Point, end: Point): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlA.x + 3 * inverse * t ** 2 * controlB.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlA.y + 3 * inverse * t ** 2 * controlB.y + t ** 3 * end.y,
  };
}

export default memo(FlowEdge);
