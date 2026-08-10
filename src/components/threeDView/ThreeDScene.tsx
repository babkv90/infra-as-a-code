import { useMemo } from 'react';
import { Bounds } from '@react-three/drei';
import { useDiagramStore } from '../../store/diagramStore';
import ThreeDContainer from './ThreeDContainer';
import ThreeDEdge from './ThreeDEdge';
import ThreeDNode from './ThreeDNode';
import { buildScenePlacements } from './coordinateMapping';

// Above this many service nodes, always-on text labels start to visually fuse into unreadable
// clutter — past this point, labels defer to hover/selection instead of showing permanently.
const DENSE_NODE_THRESHOLD = 18;

function ThreeDScene({
  onSelectNode,
  selectedNodeId,
}: {
  onSelectNode: (nodeId: string) => void;
  selectedNodeId?: string;
}) {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);

  const placements = useMemo(() => buildScenePlacements(nodes), [nodes]);
  const placementById = useMemo(() => new Map(placements.map((placement) => [placement.node.id, placement])), [placements]);
  const containerPlacements = useMemo(() => placements.filter((placement) => placement.node.type === 'groupBox'), [placements]);
  const servicePlacements = useMemo(() => placements.filter((placement) => placement.node.type === 'awsService'), [placements]);
  const declutter = servicePlacements.length > DENSE_NODE_THRESHOLD;
  const renderableEdges = useMemo(
    () =>
      edges
        .filter((edge) => edge.data?.label !== 'reference' && edge.data?.protocol !== 'Terraform')
        .map((edge) => ({ edge, source: placementById.get(edge.source), target: placementById.get(edge.target) }))
        .filter((entry): entry is { edge: typeof entry.edge; source: NonNullable<typeof entry.source>; target: NonNullable<typeof entry.target> } => Boolean(entry.source && entry.target)),
    [edges, placementById],
  );

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight castShadow intensity={0.9} position={[12, 18, 8]} shadow-mapSize={[1024, 1024]} />
      <directionalLight intensity={0.25} position={[-10, 8, -10]} />
      <mesh position={[0, -0.06, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <gridHelper args={[200, 100, '#1e293b', '#1e293b']} position={[0, -0.055, 0]} />

      {/* Fits the camera to whatever the diagram actually contains on load/change, instead of a
          fixed camera position that only happens to frame small diagrams. */}
      <Bounds clip fit margin={1.35} observe>
        {containerPlacements.map((placement) => (
          <ThreeDContainer key={placement.node.id} placement={placement} />
        ))}
        {renderableEdges.map(({ edge, source, target }) => (
          <ThreeDEdge edge={edge} key={edge.id} source={source} target={target} />
        ))}
        {servicePlacements.map((placement) => (
          <ThreeDNode
            declutter={declutter}
            isSelected={placement.node.id === selectedNodeId}
            key={placement.node.id}
            onSelect={onSelectNode}
            placement={placement}
          />
        ))}
      </Bounds>
    </>
  );
}

export default ThreeDScene;
