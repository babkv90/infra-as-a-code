import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps, type Node } from 'reactflow';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsEdgeData } from '../../types';

const edgeColors = {
  data: '#2563eb',
  event: '#f97316',
  security: '#dc2626',
  monitoring: '#64748b',
};

// Whiteboard mode collapses the 4-way connectionType palette down to the reference sketch's
// dual-color convention: black for primary data/event flow, blue for control/security/monitoring.
const whiteboardEdgeColors = {
  data: '#111111',
  event: '#111111',
  security: '#3B5FA8',
  monitoring: '#3B5FA8',
};

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

// Floor on the bezier control-point offset — just enough to avoid a degenerate zero-length
// tangent. It must stay small: a large floor forces close-together nodes into a control distance
// far bigger than the actual gap between them, which bulges the curve into an exaggerated S/loop
// shape that reads as disconnected or zigzagging even though both ends are correctly anchored.
const MIN_EDGE_RUN = 24;

function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<AwsEdgeData>) {
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const reactFlow = useReactFlow();
  const obstacles = getObstacleRects(reactFlow.getNodes(), source, target);
  // Always a single smooth curve — no obstacle-detour routing, so an edge can never zigzag
  // through extra bend points even if it happens to pass near another node.
  const [edgePath, rawLabelX, rawLabelY] = getGentleSCurvePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const connectionType = data?.connectionType ?? 'data';
  const typeColor = (whiteboardMode ? whiteboardEdgeColors : edgeColors)[connectionType];
  const color = whiteboardMode ? typeColor : selected ? typeColor : '#8b9097';
  const isGenericReference = data?.label === 'reference' && data?.protocol === 'Terraform';
  const label = data?.hiddenCount ? `${data.label} +${data.hiddenCount}` : data?.label;
  const showLabel = selected || Boolean(label && !isGenericReference);
  // Data/event edges always animate now — a diagram should read as "things are moving," not
  // just when a user happens to have that edge selected.
  const showFlowDots = !whiteboardMode && (connectionType === 'data' || connectionType === 'event');
  const labelPosition = avoidLabelOverlap({ x: rawLabelX, y: rawLabelY }, obstacles, labelOffsetForEdge(id));

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: whiteboardMode ? 1.4 : selected ? 2.6 : 1.8,
          strokeDasharray: !whiteboardMode && connectionType === 'event' ? '8 6' : undefined,
          filter: !whiteboardMode && selected ? `drop-shadow(0 0 7px ${typeColor}66)` : undefined,
        }}
      />
      {showFlowDots && <path className={`flow-dots flow-dots--${connectionType}`} d={edgePath} style={{ stroke: color }} />}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${selected ? 'edge-label--selected' : ''} ${whiteboardMode ? 'edge-label--whiteboard' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function getObstacleRects(nodes: Node[], sourceId?: string, targetId?: string): Rect[] {
  return nodes
    .filter((node) => node.id !== sourceId && node.id !== targetId)
    .filter((node) => node.type !== 'groupBox')
    .map((node) => {
      const width = Number(node.width ?? node.style?.width ?? (node.type === 'labelNode' ? 180 : 150));
      const height = Number(node.height ?? node.style?.height ?? (node.type === 'labelNode' ? 80 : 90));
      return {
        x: node.positionAbsolute?.x ?? node.position.x,
        y: node.positionAbsolute?.y ?? node.position.y,
        width: Number.isFinite(width) ? width : 150,
        height: Number.isFinite(height) ? height : 90,
      };
    });
}

function labelOffsetForEdge(id: string): { x: number; y: number } {
  const offsets = [-20, -10, 0, 10, 20];
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 997;
  }
  return { x: 0, y: offsets[hash % offsets.length] };
}

function getGentleSCurvePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'>): [string, number, number] {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy);
  const controlDistance = Math.min(Math.max(distance * 0.42, MIN_EDGE_RUN), 240);
  const sourceVector = sideVector(String(sourcePosition));
  const targetVector = sideVector(String(targetPosition));
  const sourceControlX = sourceX + sourceVector.x * controlDistance;
  const sourceControlY = sourceY + sourceVector.y * controlDistance;
  const targetControlX = targetX + targetVector.x * controlDistance;
  const targetControlY = targetY + targetVector.y * controlDistance;
  const label = cubicPoint(0.5, { x: sourceX, y: sourceY }, { x: sourceControlX, y: sourceControlY }, { x: targetControlX, y: targetControlY }, { x: targetX, y: targetY });

  return [
    `M ${sourceX},${sourceY} C ${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
    label.x,
    label.y,
  ];
}

function avoidLabelOverlap(base: Point, obstacles: Rect[], hashOffset: Point): Point {
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

function cubicPoint(
  t: number,
  start: { x: number; y: number },
  controlA: { x: number; y: number },
  controlB: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlA.x + 3 * inverse * t ** 2 * controlB.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlA.y + 3 * inverse * t ** 2 * controlB.y + t ** 3 * end.y,
  };
}

export default FlowEdge;
