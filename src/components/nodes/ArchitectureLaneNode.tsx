import type React from 'react';
import type { NodeProps } from 'reactflow';
import type { AwsNodeData } from '../../types';

function ArchitectureLaneNode({ data }: NodeProps<AwsNodeData>) {
  return (
    <section className="architecture-lane-node" style={{ '--architecture-lane-color': data.color } as React.CSSProperties}>
      <header className="architecture-lane-node__header">{data.label}</header>
    </section>
  );
}

export default ArchitectureLaneNode;
