import { memo, useState } from 'react';
import type { NodeProps } from 'reactflow';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData } from '../../types';

function LabelNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [editing, setEditing] = useState(false);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);

  return (
    <div className={`label-node ${selected ? 'selected' : ''}`} onDoubleClick={() => setEditing(true)}>
      {editing ? (
        <textarea
          className="label-node__input nodrag"
          value={data.label}
          autoFocus
          onChange={(event) => updateNodeData(id, { label: event.target.value })}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <span>{data.label}</span>
      )}
    </div>
  );
}

export default memo(LabelNode);
