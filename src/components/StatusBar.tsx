import { useMemo, useState } from 'react';
import { useDiagramStore } from '../store/diagramStore';
import { validateDiagram } from '../utils/validate';

function StatusBar() {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const activeView = useDiagramStore((state) => state.activeView);
  const activeRegion = useDiagramStore((state) => state.activeRegion);
  const lastSavedAt = useDiagramStore((state) => state.lastSavedAt);
  const [isIssuesOpen, setIsIssuesOpen] = useState(false);

  // Computed live, not read from the store's `issues` field, which only updates when validate() has
  // actually been called — this status is meant to always reflect the current diagram, not the last
  // time someone happened to click Validate.
  const issues = useMemo(() => validateDiagram(nodes, edges, activeRegion), [nodes, edges, activeRegion]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const health = errors.length ? 'red' : warnings.length ? 'yellow' : 'green';

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
      <span className="status-bar-health">
        <button className="health" onClick={() => setIsIssuesOpen((open) => !open)} type="button">
          <i className={`health-dot health-dot--${health}`} />
          {errors.length ? `${errors.length} blocking error${errors.length === 1 ? '' : 's'}` : warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : 'Healthy'}
        </button>
        {isIssuesOpen && (errors.length > 0 || warnings.length > 0) && (
          <div className="status-bar-issues">
            {errors.length > 0 && (
              <div className="status-bar-issues__group">
                <strong>Blocking — must fix before deploying</strong>
                <ul>
                  {errors.map((issue, index) => (
                    <li key={`error-${index}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className="status-bar-issues__group">
                <strong>Recommended</strong>
                <ul>
                  {warnings.map((issue, index) => (
                    <li key={`warning-${index}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </span>
    </footer>
  );
}

export default StatusBar;
