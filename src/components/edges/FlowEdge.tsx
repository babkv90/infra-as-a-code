import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';
import type { AwsEdgeData } from '../../types';

const edgeColors = {
  data: '#2563eb',
  event: '#f97316',
  security: '#dc2626',
  monitoring: '#64748b',
};

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected, style }: EdgeProps<AwsEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12, offset: 22 });
  const typeColor = edgeColors[data?.connectionType ?? 'data'];
  const color = selected ? typeColor : '#8b9097';
  const isGenericReference = data?.label === 'reference' && data?.protocol === 'Terraform';
  const label = data?.hiddenCount ? `${data.label} +${data.hiddenCount}` : data?.label;
  const showLabel = selected || Boolean(label && !isGenericReference);
  const showFlowDots = selected || data?.connectionType === 'event';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: selected ? 2.6 : 1.8,
          strokeDasharray: data?.connectionType === 'event' ? '8 6' : undefined,
          filter: selected ? `drop-shadow(0 0 7px ${typeColor}66)` : undefined,
        }}
      />
      {showFlowDots && <path className="flow-dots" d={edgePath} style={{ stroke: color }} />}
      {showLabel && (
        <EdgeLabelRenderer>
          <div className={`edge-label ${selected ? 'edge-label--selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default FlowEdge;
