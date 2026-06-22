import { memo, useState } from 'react';
import type { NodeProps } from 'reactflow';
import { groupStyles } from '../../data/awsServices';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData, GroupKind } from '../../types';

function GroupBoxNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [editing, setEditing] = useState(false);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const style = groupStyles[(data.groupKind ?? 'VPC') as GroupKind];

  return (
    <div
      className={`group-box ${selected ? 'selected' : ''}`}
      style={{ borderColor: style.color, background: style.bg }}
      onDoubleClick={() => setEditing(true)}
    >
      <div className="group-box__header" style={{ borderColor: style.color, color: style.color }}>
        {editing ? (
          <input
            className="group-title-input nodrag"
            value={data.label}
            autoFocus
            onChange={(event) => updateNodeData(id, { label: event.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setEditing(false);
            }}
          />
        ) : (
          <span>{data.label}</span>
        )}
      </div>
    </div>
  );
}

export default memo(GroupBoxNode);
