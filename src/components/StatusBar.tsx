import { useMemo, useState } from 'react';
import { useDiagramStore } from '../store/diagramStore';
import { buildVisibleGraph } from '../utils/diagramSemantics';
import { diagramStructureKey } from '../utils/graphIndex';
import { validateDiagram } from '../utils/validate';

function StatusBar() {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const activeView = useDiagramStore((state) => state.activeView);
  const detailMode = useDiagramStore((state) => state.detailMode);
  const activeRegion = useDiagramStore((state) => state.activeRegion);
  const lastSavedAt = useDiagramStore((state) => state.lastSavedAt);
  const isDirty = useDiagramStore((state) => state.isDirty);
  const [isIssuesOpen, setIsIssuesOpen] = useState(false);

  // Computed live, not read from the store's `issues` field, which only updates when validate() has
  // actually been called — this status is meant to always reflect the current diagram, not the last
  // time someone happened to click Validate. Keyed on structure so dragging a node doesn't re-run
  // the whole validation suite on every pointer tick.
  const structureKey = useMemo(() => diagramStructureKey(nodes, edges), [nodes, edges]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on structureKey by design.
  const issues = useMemo(() => validateDiagram(nodes, edges, activeRegion), [structureKey, activeRegion]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const health = errors.length ? 'red' : warnings.length ? 'yellow' : 'green';

  const visibleEdgeCount = useMemo(
    () => buildVisibleGraph(nodes, edges, activeView, detailMode).edges.length,
    [activeView, detailMode, edges, nodes],
  );

  const hiddenEdgeCount = Math.max(0, edges.length - visibleEdgeCount);
  const resourceCount = nodes.filter((node) => node.type !== 'groupBox' && node.type !== 'labelNode').length;

  return (
    <footer className="builder-status status-bar">
      <span className="builder-status__group status-bar-health">
        <button className="health" onClick={() => setIsIssuesOpen((open) => !open)} type="button">
          <i className={`health-dot health-dot--${health}`} />
          {errors.length
            ? `${errors.length} blocking error${errors.length === 1 ? '' : 's'}`
            : warnings.length
              ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
              : 'Ready to deploy'}
        </button>
        {errors.length > 0 && warnings.length > 0 && (
          <span className="builder-status__metric">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
        )}
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

      <span className="builder-bar__spacer" />

      <span className="builder-status__metric">
        <b>{resourceCount}</b> resource{resourceCount === 1 ? '' : 's'} · <b>{edges.length}</b> connection{edges.length === 1 ? '' : 's'}
      </span>
      {hiddenEdgeCount > 0 && <span className="builder-status__metric">{hiddenEdgeCount} hidden in this lens</span>}
      <span className="builder-status__metric">{activeRegion}</span>
      <span className="builder-status__metric">{lastSavedAt ? `Saved ${lastSavedAt}${isDirty ? ' · unsaved changes' : ''}` : 'Not saved'}</span>
    </footer>
  );
}

export default StatusBar;
