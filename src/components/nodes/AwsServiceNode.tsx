import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData } from '../../types';

const iconFallback = Icons.Cloud;

function AwsServiceNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const duplicateSelection = useDiagramStore((state) => state.duplicateSelection);
  const deleteSelection = useDiagramStore((state) => state.deleteSelection);
  const setSelection = useDiagramStore((state) => state.setSelection);

  const Icon = ((Icons as unknown as Record<string, typeof iconFallback>)[data.icon] ?? iconFallback);

  function closeMenu() {
    setMenu(null);
  }

  return (
    <div
      className={`aws-node ${selected ? 'selected' : ''} ${data.warning ? 'warning' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setSelection(id, undefined);
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <div className="aws-node__tile">
        <div className={`aws-node__status aws-node__status--${data.status}`} />
        <div className="aws-node__icon" style={{ color: data.color }}>
          <Icon size={28} strokeWidth={2.2} />
        </div>
        {data.ports.inputs.map((port, index) => (
          <Handle
            type="target"
            position={Position.Left}
            id={`in-${port}`}
            className="port-handle port-handle--in"
            style={{ top: handleTop(index, data.ports.inputs.length) }}
            key={`input-${port}`}
          />
        ))}
        {data.ports.outputs.map((port, index) => (
          <Handle
            type="source"
            position={Position.Right}
            id={`out-${port}`}
            className="port-handle port-handle--out"
            style={{ top: handleTop(index, data.ports.outputs.length) }}
            key={`output-${port}`}
          />
        ))}
      </div>
      <div className="aws-node__label">
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

function handleTop(index: number, count: number): number {
  const spacing = 16;
  return 30 + (index - (count - 1) / 2) * spacing;
}

export default memo(AwsServiceNode);
