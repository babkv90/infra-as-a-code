import { memo, useState } from 'react';
import { NodeResizer, type NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { groupStyles, whiteboardGroupBadges } from '../../data/awsServices';
import { useDiagramStore } from '../../store/diagramStore';
import type { AwsNodeData, GroupKind } from '../../types';

const badgeIconFallback = Icons.Box;
const minGroupSize = { minWidth: 180, minHeight: 140 };

// The group body itself is pointer-events:none (see .group-box CSS) so drags/clicks over its
// interior fall through to whatever's nested inside it or the canvas pane. That's deliberate —
// otherwise a boundary would block interaction with everything it contains — but it means the only
// way to select (and thus resize) a boundary was its small header label. These four strips give the
// visible dashed border itself a generous click/drag hit zone for selection (and, like the header,
// dragging them repositions the group) without touching the interior passthrough behavior. Only
// rendered while unselected — once selected, NodeResizer's own (enlarged) edge/handle controls take
// over the same physical area for resizing.
function BorderSelectFrame() {
  return (
    <>
      <div className="group-box__select-edge group-box__select-edge--top" />
      <div className="group-box__select-edge group-box__select-edge--right" />
      <div className="group-box__select-edge group-box__select-edge--bottom" />
      <div className="group-box__select-edge group-box__select-edge--left" />
    </>
  );
}

function GroupBoxNode({ id, data, selected }: NodeProps<AwsNodeData>) {
  const [editing, setEditing] = useState(false);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const checkpoint = useDiagramStore((state) => state.checkpoint);
  const kind = (data.groupKind ?? 'VPC') as GroupKind;
  const style = groupStyles[kind];
  const badge = whiteboardGroupBadges[kind];
  const BadgeIcon = ((Icons as unknown as Record<string, typeof badgeIconFallback>)[badge.icon] ?? badgeIconFallback);

  if (whiteboardMode) {
    return (
      <div className={`group-box group-box--whiteboard ${selected ? 'selected' : ''}`} onDoubleClick={() => setEditing(true)}>
        {!selected && <BorderSelectFrame />}
        <NodeResizer
          isVisible={selected}
          color="#111111"
          onResizeStart={checkpoint}
          handleClassName="group-box__resize-handle"
          lineClassName="group-box__resize-line"
          {...minGroupSize}
        />
        <div className="group-box__whiteboard-header">
          <span className="group-box__whiteboard-badge">
            <BadgeIcon size={12} strokeWidth={2.2} />
            {badge.label}
          </span>
          {editing ? (
            <input
              className="group-title-input group-title-input--whiteboard nodrag"
              value={data.label}
              autoFocus
              onChange={(event) => updateNodeData(id, { label: event.target.value })}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setEditing(false);
              }}
            />
          ) : (
            <span className="group-box__whiteboard-label">{data.label}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group-box ${selected ? 'selected' : ''}`}
      style={{ borderColor: style.color, background: style.bg }}
      onDoubleClick={() => setEditing(true)}
    >
      {!selected && <BorderSelectFrame />}
      <NodeResizer
        isVisible={selected}
        color={style.color}
        onResizeStart={checkpoint}
        handleClassName="group-box__resize-handle"
        lineClassName="group-box__resize-line"
        {...minGroupSize}
      />
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
