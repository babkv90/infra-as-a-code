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

const MIN_EDGE_RUN = 150;

function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<AwsEdgeData>) {
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const reactFlow = useReactFlow();
  const obstacles = getObstacleRects(reactFlow.getNodes(), source, target);
  const [edgePath, rawLabelX, rawLabelY] = getObstacleAwarePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  }, obstacles);
  const connectionType = data?.connectionType ?? 'data';
  const typeColor = (whiteboardMode ? whiteboardEdgeColors : edgeColors)[connectionType];
  const color = whiteboardMode ? typeColor : selected ? typeColor : '#8b9097';
  const isGenericReference = data?.label === 'reference' && data?.protocol === 'Terraform';
  const label = data?.hiddenCount ? `${data.label} +${data.hiddenCount}` : data?.label;
  const showLabel = selected || Boolean(label && !isGenericReference);
  const showFlowDots = !whiteboardMode && (selected || connectionType === 'event');
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
      {showFlowDots && <path className="flow-dots" d={edgePath} style={{ stroke: color }} />}
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

function getObstacleAwarePath(
  props: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'>,
  obstacles: Rect[],
): [string, number, number] {
  const gentlePath = getGentleSCurvePath(props);
  const samples = sampleCubicPath(props, 18);
  const crossesNode = obstacles.some((rect) => polylineIntersectsRect(samples, expandRect(rect, 14)));
  if (!crossesNode) return gentlePath;

  const candidates = buildDetourCandidates(props, obstacles);
  const scored = candidates
    .map((candidate) => ({
      points: candidate,
      score: pathLength(candidate) + obstacles.reduce((count, rect) => count + (polylineIntersectsRect(candidate, expandRect(rect, 16)) ? 10000 : 0), 0),
    }))
    .sort((left, right) => left.score - right.score);
  const points = scored[0]?.points ?? samples;
  const label = pointAtPolylineRatio(points, 0.5);
  return [smoothPolylinePath(points), label.x, label.y];
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

function buildDetourCandidates({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'>, obstacles: Rect[]): Point[][] {
  const start = { x: sourceX, y: sourceY };
  const end = { x: targetX, y: targetY };
  const sourceVector = sideVector(String(sourcePosition));
  const targetVector = sideVector(String(targetPosition));
  const lead = MIN_EDGE_RUN;
  const startLead = { x: start.x + sourceVector.x * lead, y: start.y + sourceVector.y * lead };
  const endLead = { x: end.x + targetVector.x * lead, y: end.y + targetVector.y * lead };
  const relevant = obstacles.filter((rect) => rectIntersectsSegmentBounds(expandRect(rect, 28), start, end));
  const topY = Math.min(sourceY, targetY, ...relevant.map((rect) => rect.y)) - 64;
  const bottomY = Math.max(sourceY, targetY, ...relevant.map((rect) => rect.y + rect.height)) + 64;
  const leftX = Math.min(sourceX, targetX, ...relevant.map((rect) => rect.x)) - 64;
  const rightX = Math.max(sourceX, targetX, ...relevant.map((rect) => rect.x + rect.width)) + 64;

  return [
    [start, startLead, { x: startLead.x, y: topY }, { x: endLead.x, y: topY }, endLead, end],
    [start, startLead, { x: startLead.x, y: bottomY }, { x: endLead.x, y: bottomY }, endLead, end],
    [start, startLead, { x: leftX, y: startLead.y }, { x: leftX, y: endLead.y }, endLead, end],
    [start, startLead, { x: rightX, y: startLead.y }, { x: rightX, y: endLead.y }, endLead, end],
  ].map(removeDuplicatePoints);
}

function smoothPolylinePath(points: Point[]): string {
  if (points.length < 2) return '';
  const radius = 22;
  let path = `M ${points[0].x},${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const before = pointToward(current, previous, Math.min(radius, distance(current, previous) / 2));
    const after = pointToward(current, next, Math.min(radius, distance(current, next) / 2));
    path += ` L ${before.x},${before.y} Q ${current.x},${current.y} ${after.x},${after.y}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x},${last.y}`;
  return path;
}

function sampleCubicPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'>, count: number): Point[] {
  const distanceValue = Math.hypot(targetX - sourceX, targetY - sourceY);
  const controlDistance = Math.min(Math.max(distanceValue * 0.42, MIN_EDGE_RUN), 240);
  const sourceVector = sideVector(String(sourcePosition));
  const targetVector = sideVector(String(targetPosition));
  const start = { x: sourceX, y: sourceY };
  const controlA = { x: sourceX + sourceVector.x * controlDistance, y: sourceY + sourceVector.y * controlDistance };
  const controlB = { x: targetX + targetVector.x * controlDistance, y: targetY + targetVector.y * controlDistance };
  const end = { x: targetX, y: targetY };
  return Array.from({ length: count + 1 }, (_, index) => cubicPoint(index / count, start, controlA, controlB, end));
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

function polylineIntersectsRect(points: Point[], rect: Rect): boolean {
  return points.some((point) => pointInRect(point, rect)) || points.slice(1).some((point, index) => segmentIntersectsRect(points[index], point, rect));
}

function segmentIntersectsRect(start: Point, end: Point, rect: Rect): boolean {
  if (!rectIntersectsSegmentBounds(rect, start, end)) return false;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  return corners.some((corner, index) => segmentsIntersect(start, end, corner, corners[(index + 1) % corners.length]));
}

function rectIntersectsSegmentBounds(rect: Rect, start: Point, end: Point): boolean {
  return !(Math.max(start.x, end.x) < rect.x || Math.min(start.x, end.x) > rect.x + rect.width || Math.max(start.y, end.y) < rect.y || Math.min(start.y, end.y) > rect.y + rect.height);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ccw = (left: Point, middle: Point, right: Point) => (right.y - left.y) * (middle.x - left.x) > (middle.y - left.y) * (right.x - left.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return !(left.x + left.width < right.x || right.x + right.width < left.x || left.y + left.height < right.y || right.y + right.height < left.y);
}

function pointInRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function expandRect(rect: Rect, padding: number): Rect {
  return { x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
}

function removeDuplicatePoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 1);
}

function pathLength(points: Point[]): number {
  return points.slice(1).reduce((length, point, index) => length + distance(points[index], point), 0);
}

function pointAtPolylineRatio(points: Point[], ratio: number): Point {
  const targetLength = pathLength(points) * ratio;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index]);
    if (travelled + segmentLength >= targetLength) {
      const segmentRatio = segmentLength ? (targetLength - travelled) / segmentLength : 0;
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * segmentRatio,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * segmentRatio,
      };
    }
    travelled += segmentLength;
  }
  return points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
}

function pointToward(from: Point, to: Point, amount: number): Point {
  const total = distance(from, to);
  if (!total) return from;
  return { x: from.x + ((to.x - from.x) / total) * amount, y: from.y + ((to.y - from.y) / total) * amount };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
