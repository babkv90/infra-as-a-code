import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps, type Node } from 'reactflow';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsEdgeData } from '../../types';

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

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const MIN_EDGE_RUN = 70;

function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<AwsEdgeData>) {
  const [isHovered, setIsHovered] = useState(false);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const reactFlow = useReactFlow();
  const obstacles = getObstacleRects(reactFlow.getNodes(), source, target);
  const [edgePath, rawLabelX, rawLabelY] = getBundledOrthogonalPath({
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
  const typeColor = (whiteboardMode ? whiteboardEdgeColors : edgeColors)[connectionType];
  const color = whiteboardMode ? typeColor : selected || data?.highlighted ? typeColor : '#8b9097';
  const isGenericReference = data?.label === 'reference' && data?.protocol === 'Terraform';
  const label = data?.hiddenCount ? `${data.label} +${data.hiddenCount}` : data?.label;
  const showLabel = Boolean(label && !isGenericReference && (selected || isHovered || data?.highlighted));
  const showFlowDots = !whiteboardMode && (selected || data?.highlighted) && (connectionType === 'data-flow' || connectionType === 'event');
  const labelPosition = avoidLabelOverlap({ x: rawLabelX, y: rawLabelY }, obstacles, labelOffsetForEdge(id));
  const strokeDasharray = whiteboardMode ? undefined : connectionType === 'security' ? '7 6' : connectionType === 'monitoring' || connectionType === 'dependency' || connectionType === 'deployment' ? '4 6' : undefined;

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
          strokeWidth: whiteboardMode ? 1.4 : selected || data?.highlighted ? 2.6 : 1.8,
          strokeDasharray,
          filter: !whiteboardMode && selected ? `drop-shadow(0 0 7px ${typeColor}66)` : undefined,
        }}
      />
      <path className="edge-hover-target" d={edgePath} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} />
      {showFlowDots && <path className="flow-dots" d={edgePath} style={{ stroke: color }} />}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label edge-label--${connectionType} ${selected ? 'edge-label--selected' : ''} ${whiteboardMode ? 'edge-label--whiteboard' : ''}`}
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
  const offsets = [-22, -11, 0, 11, 22];
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 997;
  }
  return { x: 0, y: offsets[hash % offsets.length] };
}

function getBundledOrthogonalPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  bundleIndex = 0,
  bundleSize = 1,
}: Pick<EdgeProps<AwsEdgeData>, 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition'> & { bundleIndex?: number; bundleSize?: number }): [string, number, number] {
  const sourceVector = sideVector(String(sourcePosition));
  const targetVector = sideVector(String(targetPosition));
  const lead = Math.min(Math.max(Math.abs(targetX - sourceX) * 0.28, MIN_EDGE_RUN), 180);
  const bundleOffset = (bundleIndex - (bundleSize - 1) / 2) * 14;
  const start = { x: sourceX, y: sourceY };
  const end = { x: targetX, y: targetY };
  const startLead = { x: sourceX + sourceVector.x * lead, y: sourceY + sourceVector.y * lead };
  const endLead = { x: targetX + targetVector.x * lead, y: targetY + targetVector.y * lead };
  const horizontal = Math.abs(sourceVector.x) > 0 || Math.abs(targetVector.x) > 0;
  const junction = horizontal
    ? { x: (startLead.x + endLead.x) / 2, y: (startLead.y + endLead.y) / 2 + bundleOffset }
    : { x: (startLead.x + endLead.x) / 2 + bundleOffset, y: (startLead.y + endLead.y) / 2 };
  const points = removeDuplicatePoints([
    start,
    startLead,
    horizontal ? { x: junction.x, y: startLead.y } : { x: startLead.x, y: junction.y },
    junction,
    horizontal ? { x: junction.x, y: endLead.y } : { x: endLead.x, y: junction.y },
    endLead,
    end,
  ]);
  const label = pointAtPolylineRatio(points, 0.5);
  return [smoothPolylinePath(points), label.x, label.y];
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

function smoothPolylinePath(points: Point[]): string {
  if (points.length < 2) return '';
  const radius = 18;
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

function labelRect(center: Point, size: { width: number; height: number }): Rect {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height };
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return !(left.x + left.width < right.x || right.x + right.width < left.x || left.y + left.height < right.y || right.y + right.height < left.y);
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

export default FlowEdge;
