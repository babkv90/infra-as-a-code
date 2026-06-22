import { useMemo } from 'react';
import { useDiagramStore } from '../store/diagramStore';

function StatusBar() {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const activeView = useDiagramStore((state) => state.activeView);
  const activeRegion = useDiagramStore((state) => state.activeRegion);
  const lastSavedAt = useDiagramStore((state) => state.lastSavedAt);
  const issues = useDiagramStore((state) => state.issues);

  const health = useMemo(() => {
    if (issues.some((issue) => issue.severity === 'error')) return 'red';
    if (issues.length) return 'yellow';
    return 'green';
  }, [issues]);

  const visibleEdgeCount = useMemo(() => {
    if (activeView === 'dependencies') return edges.length;
    if (activeView === 'security') return edges.filter((edge) => edge.data?.connectionType === 'security' || edge.data?.protocol === 'IAM' || edge.data?.label === 'IAM').length;
    return edges.filter((edge) => edge.data?.label !== 'reference' && edge.data?.protocol !== 'Terraform').length;
  }, [activeView, edges]);

  const hiddenEdgeCount = Math.max(0, edges.length - visibleEdgeCount);

  return (
    <footer className="status-bar">
      <span>{nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode').length} nodes</span>
      <span>{edges.length} connections</span>
      {hiddenEdgeCount > 0 && <span>{hiddenEdgeCount} hidden in {activeView}</span>}
      <span>{activeRegion}</span>
      <span>{lastSavedAt ? `Saved ${lastSavedAt}` : 'Not saved'}</span>
      <span className="health">
        <i className={`health-dot health-dot--${health}`} />
        {issues.length ? `${issues.length} warnings` : 'Healthy'}
      </span>
    </footer>
  );
}

export default StatusBar;
