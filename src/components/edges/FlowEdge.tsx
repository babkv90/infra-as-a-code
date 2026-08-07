import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type EdgeProps } from 'reactflow';
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
  const [edgePath, rawLabelX, rawLabelY] = getBundledStepPath({
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
  // Always colored by relationship category, in every lens — a flat gray default (color only on
  // select/highlight) was exactly what made the flow unreadable at a glance: data-flow, security,
  // network-routing and dependency edges were visually identical until you clicked one. Selection
  // still reads clearly via stroke width and the drop-shadow glow below, not via color.
  const color = typeColor;
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

// 2px corners, right angles otherwise — matches the deterministic layered layout's own geometry
// (Fix 2/3) far better than a bezier, which reads as a diagonal "as the crow flies" line that has no
// relationship to the actual left-to-right layer structure.
const CORNER_RADIUS = 2;
// Multiple edges converging on the same target (an edgeBundles slot) fan out across the handle's
// side instead of all landing on the exact same point — spacing per slot, capped so the fan never
// reaches past the card's own face even with a large bundle.
const BUNDLE_SLOT_SPACING = 16;
const MAX_BUNDLE_SPREAD = 84;

function getBundledStepPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  bundleIndex = 0,
  bundleSize = 1,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'> & { bundleIndex?: number; bundleSize?: number }): [string, number, number] {
  const bundleOffset =
    bundleSize > 1 ? (bundleIndex - (bundleSize - 1) / 2) * Math.min(BUNDLE_SLOT_SPACING, MAX_BUNDLE_SPREAD / (bundleSize - 1)) : 0;
  const isTargetVerticalSide = targetPosition === Position.Top || targetPosition === Position.Bottom;
  const adjustedTargetX = isTargetVerticalSide ? targetX + bundleOffset : targetX;
  const adjustedTargetY = isTargetVerticalSide ? targetY : targetY + bundleOffset;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: adjustedTargetX,
    targetY: adjustedTargetY,
    targetPosition,
    borderRadius: CORNER_RADIUS,
  });

  return [path, labelX, labelY];
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

export default memo(FlowEdge);
