import { useState } from 'react';
import * as Icons from 'lucide-react';
import { Html } from '@react-three/drei';
import { NODE_BLOCK_HEIGHT } from './coordinateMapping';
import type { ScenePlacement } from './coordinateMapping';

const iconFallback = Icons.Cloud;
// Blocks are drawn smaller than their full 2D footprint so neighboring nodes don't visually fuse
// together at a glance — the 2D canvas has empty margin around each node too, it's just implicit in
// the layout instead of the geometry.
const FOOTPRINT_RATIO = 0.62;

function ThreeDNode({
  placement,
  onSelect,
  declutter,
  isSelected,
}: {
  placement: ScenePlacement;
  onSelect: (nodeId: string) => void;
  declutter: boolean;
  isSelected: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const { node } = placement;
  const Icon = ((Icons as unknown as Record<string, typeof iconFallback>)[node.data.icon] ?? iconFallback);
  const blockWidth = placement.worldWidth * FOOTPRINT_RATIO;
  const blockDepth = placement.worldDepth * FOOTPRINT_RATIO;
  // Dense diagrams only reveal a node's text label on hover (or once it's the selected node) —
  // the icon badge always stays visible so the scene still reads at a glance, it's just the
  // potentially-long label text competing for space that gets deferred.
  const showLabel = !declutter || isHovered || isSelected;

  return (
    <group position={[placement.worldX, placement.baseY, placement.worldZ]}>
      <mesh
        castShadow
        position={[0, NODE_BLOCK_HEIGHT / 2, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setIsHovered(true);
        }}
        onPointerOut={() => setIsHovered(false)}
        scale={isHovered ? 1.06 : 1}
      >
        <boxGeometry args={[blockWidth, NODE_BLOCK_HEIGHT, blockDepth]} />
        <meshStandardMaterial color={node.data.color} />
      </mesh>
      <Html position={[0, NODE_BLOCK_HEIGHT + 0.32, 0]} center occlude={false} style={{ pointerEvents: 'none' }}>
        <div className={`three-d-node-tag ${isHovered ? 'three-d-node-tag--hovered' : ''} ${isSelected ? 'three-d-node-tag--selected' : ''}`}>
          <span className="three-d-node-tag__icon" style={{ backgroundColor: node.data.color }}>
            <Icon size={14} strokeWidth={2.2} color="#ffffff" />
          </span>
          {showLabel && <span className="three-d-node-tag__label">{node.data.label}</span>}
        </div>
      </Html>
    </group>
  );
}

export default ThreeDNode;
