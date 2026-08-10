import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { groupStyles } from '../../data/awsServices';
import type { GroupKind } from '../../types';
import { PLATFORM_THICKNESS, type ScenePlacement } from './coordinateMapping';

// A container node (VPC / Subnet / Availability Zone / Security Group / ...) renders as a flat,
// tinted platform at its nesting-depth elevation — the same border-color-per-kind convention as the
// 2D GroupBoxNode, just read from above instead of drawn as a dashed rectangle.
function ThreeDContainer({ placement }: { placement: ScenePlacement }) {
  const kind = (placement.node.data.groupKind ?? 'VPC') as GroupKind;
  const style = groupStyles[kind];
  const edgesGeometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(placement.worldWidth, PLATFORM_THICKNESS, placement.worldDepth)),
    [placement.worldWidth, placement.worldDepth],
  );

  return (
    <group position={[placement.worldX, placement.baseY, placement.worldZ]}>
      <mesh position={[0, -PLATFORM_THICKNESS / 2, 0]} receiveShadow>
        <boxGeometry args={[placement.worldWidth, PLATFORM_THICKNESS, placement.worldDepth]} />
        <meshStandardMaterial color={style.color} opacity={0.16} transparent />
      </mesh>
      <lineSegments position={[0, -PLATFORM_THICKNESS / 2, 0]} geometry={edgesGeometry}>
        <lineBasicMaterial color={style.color} />
      </lineSegments>
      <Html
        position={[-placement.worldWidth / 2 + 0.3, 0.05, -placement.worldDepth / 2 + 0.3]}
        transform={false}
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <div className="three-d-container-label" style={{ borderColor: style.color, color: style.color }}>
          {placement.node.data.label}
        </div>
      </Html>
    </group>
  );
}

export default ThreeDContainer;
