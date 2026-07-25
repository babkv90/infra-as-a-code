import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Circle, Loader2, Minus, Rocket, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeploymentMonitorStore } from '../../store/deploymentMonitorStore';
import { getDeployment, type DeploymentRecord } from '../../utils/deploymentApi';
import { buildResourceTimeline, type ResourceProgress } from '../../utils/deploymentResourceTimeline';

// Scoped to the Visual Builder's deploy/update flow only — not destroys. 'deployed' and 'failed' are
// the two terminal outcomes that end a deploy; reaching either one auto-closes this popup after a
// short pause (see the effect below), rather than requiring a manual close.
const ACTIVE_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying'];
const TERMINAL_STATUSES: DeploymentRecord['status'][] = ['deployed', 'failed'];
const POLL_MS = 2500;
const AUTO_CLOSE_DELAY_MS = 3000;
const DEFAULT_POSITION = { x: 20, y: 76 };

export function DeploymentLiveMonitor() {
  const { activeDeploymentId, isOpen, isMinimized, position, minimize, restore, close, setPosition } = useDeploymentMonitorStore();
  const [deployment, setDeployment] = useState<DeploymentRecord>();
  const [loadError, setLoadError] = useState('');
  const [showRawLog, setShowRawLog] = useState(false);
  // Mirrors `deployment.status` outside React state so the interval below can check "are we still
  // active" against the latest value without putting `deployment` in its own dependency array (which
  // would tear down and recreate the interval — and reset its timing — on every single poll tick).
  const statusRef = useRef<DeploymentRecord['status'] | undefined>(undefined);
  useEffect(() => {
    statusRef.current = deployment?.status;
  }, [deployment?.status]);

  useEffect(() => {
    if (!isOpen || !activeDeploymentId) return;
    let isMounted = true;

    function fetchOnce() {
      getDeployment(activeDeploymentId as string)
        .then((record) => {
          if (isMounted) setDeployment(record);
        })
        .catch((error: unknown) => {
          if (isMounted) setLoadError(error instanceof Error ? error.message : 'Could not load deployment status.');
        });
    }

    fetchOnce();
    const timer = window.setInterval(() => {
      if (statusRef.current && !ACTIVE_STATUSES.includes(statusRef.current)) return;
      fetchOnce();
    }, POLL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [isOpen, activeDeploymentId]);

  useEffect(() => {
    setDeployment(undefined);
    setLoadError('');
    setShowRawLog(false);
  }, [activeDeploymentId]);

  // Auto-dismiss once the deploy reaches a final outcome — a brief pause so "Deployed successfully"
  // or "Failed" is actually readable before it vanishes, rather than disappearing the instant the
  // status flips.
  useEffect(() => {
    if (!deployment || !TERMINAL_STATUSES.includes(deployment.status)) return;
    const timer = window.setTimeout(close, AUTO_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deployment?.status, close]);

  const timeline = useMemo(() => (deployment ? buildResourceTimeline(deployment) : []), [deployment]);
  const createdCount = timeline.filter((r) => r.phase === 'created' || r.phase === 'modified').length;
  const errorResource = timeline.find((r) => r.phase === 'error');

  const pos = position ?? DEFAULT_POSITION;
  const drag = useDrag(pos, setPosition);

  if (!isOpen || !activeDeploymentId) return null;

  if (isMinimized) {
    return (
      <button
        aria-label="Restore deployment monitor"
        className={`deploy-monitor-mini deploy-monitor-mini--${statusTone(deployment?.status)}`}
        onClick={restore}
        style={{ right: pos.x, top: pos.y }}
        type="button"
      >
        <StatusGlyph status={deployment?.status} />
        <span>{createdCount}/{timeline.length || '…'}</span>
      </button>
    );
  }

  return (
    <section className="deploy-monitor" style={{ right: pos.x, top: pos.y }}>
      <header className="deploy-monitor__header" onPointerDown={drag.onPointerDown}>
        <div className="deploy-monitor__title">
          <StatusGlyph status={deployment?.status} />
          <div>
            <strong>{deployment?.name ?? 'Deployment'}</strong>
            <span>{statusLabel(deployment?.status)}</span>
          </div>
        </div>
        <div className="deploy-monitor__actions">
          <button aria-label="Minimize" onClick={minimize} onPointerDown={(event) => event.stopPropagation()} type="button">
            <Minus size={13} />
          </button>
          <button aria-label="Close" onClick={close} onPointerDown={(event) => event.stopPropagation()} type="button">
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="deploy-monitor__progress">
        <div className="deploy-monitor__progress-bar">
          <span style={{ width: timeline.length ? `${(createdCount / timeline.length) * 100}%` : '0%' }} />
        </div>
        <em>{createdCount} of {timeline.length} resources created</em>
      </div>

      {loadError && <div className="deploy-monitor__banner deploy-monitor__banner--error">{loadError}</div>}
      {errorResource && (
        <div className="deploy-monitor__banner deploy-monitor__banner--error">
          Stopped at <code>{errorResource.address}</code>: {errorResource.errorMessage}
        </div>
      )}

      <ol className="deploy-monitor__list">
        {timeline.length === 0 && <li className="deploy-monitor__empty">Waiting for Terraform to start…</li>}
        {timeline.map((resource) => (
          <li className={`deploy-monitor__item deploy-monitor__item--${resource.phase}`} key={resource.address}>
            <ResourcePhaseIcon phase={resource.phase} />
            <div>
              <strong>{resource.resourceName || resource.resourceType}</strong>
              <span>{resource.resourceType}{resource.elapsed ? ` · ${resource.elapsed}` : ''}</span>
              {resource.phase === 'error' && resource.errorMessage && <em>{resource.errorMessage}</em>}
            </div>
          </li>
        ))}
      </ol>

      <footer className="deploy-monitor__footer">
        <button onClick={() => setShowRawLog((value) => !value)} type="button">
          {showRawLog ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {showRawLog ? 'Hide raw log' : 'Show raw log'}
        </button>
      </footer>

      {showRawLog && (
        <pre className="deploy-monitor__raw-log">
          {(deployment?.logs ?? []).slice(-40).map((log) => `${log.level === 'error' ? '✕ ' : ''}${log.message}`).join('\n')}
        </pre>
      )}
    </section>
  );
}

function StatusGlyph({ status }: { status?: DeploymentRecord['status'] }) {
  if (status === 'deployed') return <CheckCircle2 className="deploy-monitor__glyph deploy-monitor__glyph--success" size={16} />;
  if (status === 'destroyed') return <Trash2 className="deploy-monitor__glyph deploy-monitor__glyph--neutral" size={16} />;
  if (status === 'failed' || status === 'cancelled') return <AlertTriangle className="deploy-monitor__glyph deploy-monitor__glyph--error" size={16} />;
  if (status === 'deploying' || status === 'queued' || status === 'destroying') {
    return <Loader2 className="deploy-monitor__glyph deploy-monitor__glyph--active deploy-monitor__spin" size={16} />;
  }
  return <Rocket className="deploy-monitor__glyph" size={16} />;
}

function ResourcePhaseIcon({ phase }: { phase: ResourceProgress['phase'] }) {
  if (phase === 'created' || phase === 'modified') return <CheckCircle2 className="deploy-monitor__glyph deploy-monitor__glyph--success" size={15} />;
  if (phase === 'destroyed') return <Trash2 className="deploy-monitor__glyph deploy-monitor__glyph--neutral" size={15} />;
  if (phase === 'error') return <AlertTriangle className="deploy-monitor__glyph deploy-monitor__glyph--error" size={15} />;
  if (phase === 'creating' || phase === 'modifying' || phase === 'destroying' || phase === 'refreshing') {
    return <Loader2 className="deploy-monitor__glyph deploy-monitor__glyph--active deploy-monitor__spin" size={15} />;
  }
  return <Circle className="deploy-monitor__glyph deploy-monitor__glyph--pending" size={15} />;
}

function statusLabel(status?: DeploymentRecord['status']) {
  switch (status) {
    case 'queued':
      return 'Queued…';
    case 'deploying':
      return 'Deploying…';
    case 'deployed':
      return 'Deployed successfully';
    case 'destroying':
      return 'Destroying…';
    case 'destroyed':
      return 'Destroyed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Loading…';
  }
}

function statusTone(status?: DeploymentRecord['status']) {
  if (status === 'deployed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'error';
  if (status === 'destroyed') return 'neutral';
  return 'active';
}

// Minimal pointer-drag: header pointerdown captures the pointer and starts tracking; every move
// updates the shared store position (also what the minimized icon reads, so it collapses in place);
// pointerup releases. No dependency needed — this is the same primitive reactflow/most drag
// implementations build on, just without any of the node-graph semantics this popup doesn't need.
function useDrag(current: { x: number; y: number }, setPosition: (position: { x: number; y: number }) => void) {
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  function onPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest('button')) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragState.current = { startX: event.clientX, startY: event.clientY, originX: current.x, originY: current.y };

    function onMove(moveEvent: PointerEvent) {
      if (!dragState.current) return;
      // x tracks distance from the right edge (see DEFAULT_POSITION / the `right:` CSS below), so
      // moving the pointer right must shrink it, not grow it — the opposite of a plain left-anchored
      // drag.
      const nextX = dragState.current.originX - (moveEvent.clientX - dragState.current.startX);
      const nextY = dragState.current.originY + (moveEvent.clientY - dragState.current.startY);
      const maxX = window.innerWidth - 40;
      const maxY = window.innerHeight - 40;
      setPosition({ x: Math.min(Math.max(nextX, 0), maxX), y: Math.min(Math.max(nextY, 0), maxY) });
    }

    function onUp() {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return { onPointerDown };
}
