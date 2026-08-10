import { QuadraticBezierLine } from '@react-three/drei';
import type { AwsEdge } from '../../types';
import { NODE_BLOCK_HEIGHT, type ScenePlacement } from './coordinateMapping';

// Same connection-type palette as the 2D FlowEdge, so a service that reads as "security" (red) or
// "monitoring" (gray) in the flat diagram reads the same way up here.
const edgeColors: Record<string, string> = {
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

function ThreeDEdge({ edge, source, target }: { edge: AwsEdge; source: ScenePlacement; target: ScenePlacement }) {
  const category = edge.data?.semanticCategory ?? edge.data?.connectionType ?? 'data-flow';
  const color = edgeColors[category] ?? edgeColors['data-flow'];
  const start: [number, number, number] = [source.worldX, source.baseY + NODE_BLOCK_HEIGHT, source.worldZ];
  const end: [number, number, number] = [target.worldX, target.baseY + NODE_BLOCK_HEIGHT, target.worldZ];
  const mid: [number, number, number] = [
    (start[0] + end[0]) / 2,
    Math.max(start[1], end[1]) + 0.6,
    (start[2] + end[2]) / 2,
  ];

  return <QuadraticBezierLine start={start} end={end} mid={mid} color={color} lineWidth={1.4} />;
}

export default ThreeDEdge;
