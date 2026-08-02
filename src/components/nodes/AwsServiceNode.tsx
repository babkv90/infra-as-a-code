import type React from 'react';
import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { whiteboardOutlineServiceIds } from '../../data/awsServices';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData } from '../../types';
import { buildHandleId, type ConnectionSide } from '../../utils/connectionRouting';

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

  const Icon = ((Icons as unknown as Record<string, typeof iconFallback>)[data.icon] ?? iconFallback);
  const isWhiteboardOutline = whiteboardMode && (data.serviceId ? whiteboardOutlineServiceIds.has(data.serviceId) : false);

  function closeMenu() {
    setMenu(null);
  }

  return (
    <div
      className={`aws-node ${whiteboardMode ? 'aws-node--whiteboard' : ''} ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setSelection(id, undefined);
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div
        className={`aws-node__tile ${whiteboardMode ? `aws-node__tile--whiteboard ${isWhiteboardOutline ? 'aws-node__tile--outline' : 'aws-node__tile--badge'}` : ''}`}
        style={whiteboardMode && !isWhiteboardOutline ? ({ '--aws-node-badge-color': data.color } as React.CSSProperties) : undefined}
      >
        <div className={`aws-node__status aws-node__status--${data.status}`} />
        <div
          className="aws-node__icon"
          style={{ color: whiteboardMode ? (isWhiteboardOutline ? '#111111' : '#ffffff') : data.color }}
        >
          <Icon size={whiteboardMode ? 24 : 28} strokeWidth={whiteboardMode ? 1.8 : 2.2} />
        </div>
        {connectionSides.flatMap((side) =>
          data.ports.inputs.map((port, index) => (
            <Handle
              type="target"
              position={reactFlowPositionBySide[side]}
              id={buildHandleId('in', side, port)}
              className={`port-handle port-handle--in port-handle--${side}`}
              style={handleStyle(side, index, data.ports.inputs.length, 'in')}
              key={`input-${side}-${port}`}
            />
          )),
        )}
        {connectionSides.flatMap((side) =>
          data.ports.outputs.map((port, index) => (
            <Handle
              type="source"
              position={reactFlowPositionBySide[side]}
              id={buildHandleId('out', side, port)}
              className={`port-handle port-handle--out port-handle--${side}`}
              style={handleStyle(side, index, data.ports.outputs.length, 'out')}
              key={`output-${side}-${port}`}
            />
          )),
        )}
      </div>
      <div className={`aws-node__label ${whiteboardMode ? 'aws-node__label--whiteboard' : ''}`}>
        <span>{data.label}</span>
      </div>

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

function handleStyle(side: ConnectionSide, index: number, count: number, kind: 'in' | 'out'): React.CSSProperties {
  const offset = handleOffset(index, count);
  const pairedOffset = kind === 'in' ? -4 : 4;
  if (side === 'left' || side === 'right') return { top: offset + pairedOffset };
  return { left: offset + pairedOffset };
}

function handleOffset(index: number, count: number): number {
  const spacing = 16;
  return 30 + (index - (count - 1) / 2) * spacing;
}

export default memo(AwsServiceNode);
