import type React from 'react';
import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { whiteboardOutlineServiceIds } from '../../data/awsServices';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData } from '../../types';
import { buildHandleId, type ConnectionSide } from '../../utils/connectionRouting';
import { semanticEdgeCategory } from '../../utils/diagramSemantics';

const iconFallback = Icons.Cloud;
const connectionSides: ConnectionSide[] = ['left', 'right', 'top', 'bottom'];
const reactFlowPositionBySide = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} satisfies Record<ConnectionSide, Position>;

function AwsServiceNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const duplicateSelection = useDiagramStore((state) => state.duplicateSelection);
  const deleteSelection = useDiagramStore((state) => state.deleteSelection);
  const setSelection = useDiagramStore((state) => state.setSelection);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const relationshipBadges = useDiagramStore((state) => {
    const protectedEdges = state.edges.filter((edge) => edge.target === id || edge.source === id);
    const counts = protectedEdges.reduce(
      (accumulator, edge) => {
        const category = semanticEdgeCategory(edge, state.nodes);
        if (category === 'security' || category === 'monitoring' || category === 'deployment') accumulator[category] += 1;
        return accumulator;
      },
      { security: 0, monitoring: 0, deployment: 0 },
    );
    return counts;
  });

  const Icon = ((Icons as unknown as Record<string, typeof iconFallback>)[data.icon] ?? iconFallback);
  const isWhiteboardOutline = whiteboardMode && (data.serviceId ? whiteboardOutlineServiceIds.has(data.serviceId) : false);

  function closeMenu() {
    setMenu(null);
  }

  return (
    <div
      className={`aws-node ${whiteboardMode ? 'aws-node--whiteboard' : ''} ${architectureViewMode ? 'aws-node--architecture' : ''} ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setSelection(id, undefined);
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div
        className={`aws-node__tile ${whiteboardMode ? `aws-node__tile--whiteboard ${isWhiteboardOutline ? 'aws-node__tile--outline' : 'aws-node__tile--badge'}` : ''} ${architectureViewMode ? 'aws-node__tile--architecture' : ''}`}
        style={(whiteboardMode && !isWhiteboardOutline) || architectureViewMode ? ({ '--aws-node-badge-color': data.color } as React.CSSProperties) : undefined}
      >
        <div className={`aws-node__status aws-node__status--${data.status}`} />
        <div
          className="aws-node__icon"
          style={{ color: whiteboardMode ? (isWhiteboardOutline ? '#111111' : '#ffffff') : architectureViewMode ? '#ffffff' : data.color }}
        >
          <Icon size={whiteboardMode || architectureViewMode ? 24 : 28} strokeWidth={whiteboardMode || architectureViewMode ? 1.8 : 2.2} />
        </div>
        {data.ports.inputs.length > 0 &&
          connectionSides.map((side) => (
            <Handle
              type="target"
              position={reactFlowPositionBySide[side]}
              id={buildHandleId('in', side, data.ports.inputs[0])}
              className={`port-handle port-handle--in port-handle--${side}`}
              key={`input-${side}`}
            />
          ))}
        {data.ports.outputs.length > 0 &&
          connectionSides.map((side) => (
            <Handle
              type="source"
              position={reactFlowPositionBySide[side]}
              id={buildHandleId('out', side, data.ports.outputs[0])}
              className={`port-handle port-handle--out port-handle--${side}`}
              key={`output-${side}`}
            />
          ))}
      </div>
      <div className={`aws-node__label ${whiteboardMode ? 'aws-node__label--whiteboard' : ''} ${architectureViewMode ? 'aws-node__label--architecture' : ''}`}>
        <span>{data.label}</span>
      </div>
      {(relationshipBadges.security > 0 || relationshipBadges.monitoring > 0 || relationshipBadges.deployment > 0) && (
        <div className="aws-node__relationship-badges" aria-label="Secondary relationships">
          {relationshipBadges.security > 0 && <span className="aws-node__relationship-badge aws-node__relationship-badge--security">sec {relationshipBadges.security}</span>}
          {relationshipBadges.monitoring > 0 && <span className="aws-node__relationship-badge aws-node__relationship-badge--monitoring">mon {relationshipBadges.monitoring}</span>}
          {relationshipBadges.deployment > 0 && <span className="aws-node__relationship-badge aws-node__relationship-badge--deployment">dep {relationshipBadges.deployment}</span>}
        </div>
      )}

      {data.warning && <div className="node-warning">{data.warning}</div>}

      {menu && (
        <div className="context-menu nowheel" style={{ left: menu.x, top: menu.y }} onMouseLeave={closeMenu}>
          <button
            onClick={() => {
              duplicateSelection();
              closeMenu();
            }}
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(data.arn);
              closeMenu();
            }}
          >
            Copy ARN
          </button>
          <button
            onClick={() => {
              updateNodeData(id, { note: data.note || 'Review IAM access, network exposure, and encryption settings.' });
              closeMenu();
            }}
          >
            Add note
          </button>
          <button
            className="danger"
            onClick={() => {
              deleteSelection();
              closeMenu();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(AwsServiceNode);
