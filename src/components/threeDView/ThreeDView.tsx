import { Suspense, useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useDiagramStore } from '../../store/diagramStore';
import ThreeDScene from './ThreeDScene';

const iconFallback = Icons.Cloud;

function ThreeDLoadingFallback() {
  return (
    <div className="three-d-loading">
      <span>Building 3D scene...</span>
    </div>
  );
}

// View-only by design: this renders the same nodes/edges as the 2D canvas (no separate 3D layout
// or editing state), so it can never drift out of sync with what was actually built there. Editing
// still only happens in the 2D tab.
function ThreeDView() {
  const nodes = useDiagramStore((state) => state.nodes);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [cameraResetKey, setCameraResetKey] = useState(0);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const SelectedIcon = selectedNode ? ((Icons as unknown as Record<string, typeof iconFallback>)[selectedNode.data.icon] ?? iconFallback) : iconFallback;

  return (
    <div className="three-d-view-root">
      <div className="three-d-view-toolbar">
        <span className="three-d-view-toolbar__hint">Drag to orbit - scroll to zoom - right-click to pan - click a service for details</span>
        <button className="three-d-view-reset-button" onClick={() => setCameraResetKey((value) => value + 1)} type="button">
          Reset view
        </button>
      </div>
      <Canvas key={cameraResetKey} shadows>
        <PerspectiveCamera fov={42} makeDefault position={[16, 14, 16]} />
        <OrbitControls enableDamping maxDistance={60} maxPolarAngle={Math.PI / 2.05} minDistance={4} />
        <Suspense fallback={<Html><ThreeDLoadingFallback /></Html>}>
          <ThreeDScene onSelectNode={setSelectedNodeId} selectedNodeId={selectedNodeId} />
        </Suspense>
      </Canvas>
      {!nodes.length && (
        <div className="three-d-empty-state">
          <span>Nothing to show yet - add services on the 2D tab first.</span>
        </div>
      )}
      {selectedNode && (
        <aside className="three-d-inspector">
          <button className="three-d-inspector__close" onClick={() => setSelectedNodeId(undefined)} type="button" aria-label="Close details">
            <Icons.X size={15} />
          </button>
          <div className="three-d-inspector__header">
            <span className="three-d-inspector__icon" style={{ backgroundColor: selectedNode.data.color }}>
              <SelectedIcon size={18} color="#ffffff" strokeWidth={2.2} />
            </span>
            <div>
              <strong>{selectedNode.data.label}</strong>
              <span>{selectedNode.data.serviceName}</span>
            </div>
          </div>
          <dl className="three-d-inspector__fields">
            <div>
              <dt>Region</dt>
              <dd>{selectedNode.data.region || '-'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedNode.data.status}</dd>
            </div>
            {selectedNode.data.subLabel && (
              <div>
                <dt>Type</dt>
                <dd>{selectedNode.data.subLabel}</dd>
              </div>
            )}
          </dl>
        </aside>
      )}
    </div>
  );
}

export default ThreeDView;
