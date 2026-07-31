import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Circle, ExternalLink, Loader2, Minus, Rocket, ScrollText, Trash2, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeploymentMonitorStore } from '../../store/deploymentMonitorStore';
import {
  getDeployment,
  getDeploymentGithubRun,
  getDeploymentGithubRunJobLogs,
  type DeploymentRecord,
  type GithubRunStatus,
} from '../../utils/deploymentApi';
import { buildResourceTimeline, type ResourceProgress } from '../../utils/deploymentResourceTimeline';

const GITHUB_ACTIVE_RUN_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
const GITHUB_POLL_MS = 3000;

// A failed first-time apply can trigger an automatic cleanup destroy behind the scenes (see
// deploymentGuards.js) — deployment.status moves deploying -> failed -> destroying -> destroyed, all
// without any user action. 'destroying' and 'failed' both have to stay in ACTIVE_STATUSES (not just
// 'deploying'/'queued') so polling keeps following that whole chain instead of freezing on the first
// 'failed' reading — the poll loop below stops fetching entirely the moment it sees a status outside
// this list, which previously meant it never learned the auto-cleanup destroy that followed even
// started, let alone that it finished. 'destroyed' has to be in TERMINAL_STATUSES for the same reason
// in reverse: without it, a deployment that settles there just sits open forever instead of
// auto-closing like every other finished outcome does.
const ACTIVE_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying', 'destroying', 'failed'];
const TERMINAL_STATUSES: DeploymentRecord['status'][] = ['deployed', 'destroyed', 'failed'];
const POLL_MS = 2500;
const AUTO_CLOSE_DELAY_MS = 3000;
const DEFAULT_POSITION = { x: 20, y: 76 };

export function DeploymentLiveMonitor() {
  const { activeDeploymentId, isOpen, isMinimized, position, minimize, restore, close, setPosition } = useDeploymentMonitorStore();
  const [deployment, setDeployment] = useState<DeploymentRecord>();
  const [loadError, setLoadError] = useState('');
  const [showRawLog, setShowRawLog] = useState(false);
  const [showGithubLog, setShowGithubLog] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubRunStatus>();
  const [githubStatusError, setGithubStatusError] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<number>();
  const [jobLogText, setJobLogText] = useState('');
  const [jobLogError, setJobLogError] = useState('');
  const [isLoadingJobLog, setIsLoadingJobLog] = useState(false);
  const [followJobLog, setFollowJobLog] = useState(true);
  const jobLogRef = useRef<HTMLPreElement | null>(null);
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
    setShowGithubLog(false);
    setGithubStatus(undefined);
    setGithubStatusError('');
    setSelectedJobId(undefined);
    setJobLogText('');
    setJobLogError('');
    setFollowJobLog(true);
  }, [activeDeploymentId]);

  const isGithubExecutor = deployment?.executor === 'github-actions';

  // Only polls while the panel is actually open — a live view of the run GitHub is executing for
  // this deployment right now, not the backend's own summarized log lines (that's "Show raw log"
  // above). Stops once the run reaches a terminal status; a closed panel never polls at all.
  useEffect(() => {
    if (!showGithubLog || !isGithubExecutor || !activeDeploymentId) return;
    let isMounted = true;

    async function poll() {
      try {
        const status = await getDeploymentGithubRun(activeDeploymentId as string);
        if (!isMounted) return;
        setGithubStatus(status);
        setGithubStatusError('');
        setSelectedJobId((current) => {
          if (current && status.jobs.some((job) => job.id === current)) return current;
          const active = status.jobs.find((job) => GITHUB_ACTIVE_RUN_STATUSES.includes(job.status));
          return active?.id ?? status.jobs[status.jobs.length - 1]?.id;
        });
      } catch (error) {
        if (!isMounted) return;
        setGithubStatusError(error instanceof Error ? error.message : 'Could not load GitHub Actions status.');
      }
    }

    void poll();
    const isRunTerminal = githubStatus?.run && !GITHUB_ACTIVE_RUN_STATUSES.includes(githubStatus.run.status);
    if (isRunTerminal) return () => { isMounted = false; };

    const timer = window.setInterval(() => void poll(), GITHUB_POLL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGithubLog, isGithubExecutor, activeDeploymentId, githubStatus?.run?.status]);

  // Live-tails the selected job's raw text — re-fetches on an interval while that job is still
  // running, and once more right after it completes to pick up the final lines, then stops.
  useEffect(() => {
    if (!showGithubLog || !activeDeploymentId || !selectedJobId) return;
    let isMounted = true;

    async function fetchLogs() {
      setIsLoadingJobLog(true);
      try {
        const result = await getDeploymentGithubRunJobLogs(activeDeploymentId as string, selectedJobId as number);
        if (!isMounted) return;
        setJobLogText(result.text);
        setJobLogError('');
      } catch (error) {
        if (!isMounted) return;
        setJobLogError(error instanceof Error ? error.message : 'Logs for this job are not available yet.');
      } finally {
        if (isMounted) setIsLoadingJobLog(false);
      }
    }

    void fetchLogs();
    const job = githubStatus?.jobs.find((candidate) => candidate.id === selectedJobId);
    const isJobActive = !job || GITHUB_ACTIVE_RUN_STATUSES.includes(job.status);
    if (!isJobActive) return () => { isMounted = false; };

    const timer = window.setInterval(() => void fetchLogs(), GITHUB_POLL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [showGithubLog, activeDeploymentId, selectedJobId, githubStatus?.jobs]);

  useEffect(() => {
    if (!followJobLog || !jobLogRef.current) return;
    jobLogRef.current.scrollTop = jobLogRef.current.scrollHeight;
  }, [jobLogText, followJobLog]);

  function handleJobLogScroll() {
    const el = jobLogRef.current;
    if (!el) return;
    setFollowJobLog(el.scrollHeight - el.scrollTop - el.clientHeight < 20);
  }

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
        {isGithubExecutor && (
          <button onClick={() => setShowGithubLog((value) => !value)} type="button">
            <ScrollText size={12} />
            {showGithubLog ? 'Hide GitHub Actions log' : 'Show GitHub Actions log'}
          </button>
        )}
      </footer>

      {showRawLog && (
        <pre className="deploy-monitor__raw-log">
          {(deployment?.logs ?? []).slice(-40).map((log) => `${log.level === 'error' ? '✕ ' : ''}${log.message}`).join('\n')}
        </pre>
      )}

      {showGithubLog && (
        <div className="deploy-monitor__github">
          {githubStatusError && <div className="deploy-monitor__banner deploy-monitor__banner--error">{githubStatusError}</div>}

          {!githubStatus?.run && !githubStatusError && (
            <div className="deploy-monitor__github-waiting">
              <Loader2 className="deploy-monitor__spin" size={13} />
              Waiting for GitHub to report this run…
            </div>
          )}

          {githubStatus?.run && (
            <>
              <div className="deploy-monitor__github-run">
                <RunStateGlyph status={githubStatus.run.status} conclusion={githubStatus.run.conclusion} />
                <span>Run #{githubStatus.run.runNumber} · {runStateLabel(githubStatus.run.status, githubStatus.run.conclusion)}</span>
                <a href={githubStatus.run.htmlUrl} target="_blank" rel="noreferrer" title="Open this run on GitHub">
                  <ExternalLink size={12} />
                </a>
              </div>

              {githubStatus.jobs.length > 1 && (
                <div className="deploy-monitor__github-jobs">
                  {githubStatus.jobs.map((job) => (
                    <button
                      className={`deploy-monitor__github-job${job.id === selectedJobId ? ' deploy-monitor__github-job--active' : ''}`}
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      type="button"
                    >
                      <RunStateGlyph status={job.status} conclusion={job.conclusion} small />
                      {job.name}
                    </button>
                  ))}
                </div>
              )}

              {githubStatus.jobs.find((job) => job.id === selectedJobId)?.steps.map((step) => (
                <div className="deploy-monitor__github-step" key={step.number}>
                  <RunStateGlyph status={step.status} conclusion={step.conclusion} small />
                  <span>{step.name}</span>
                </div>
              ))}
            </>
          )}

          {jobLogError && <div className="deploy-monitor__banner deploy-monitor__banner--error">{jobLogError}</div>}

          <pre className="deploy-monitor__github-log" onScroll={handleJobLogScroll} ref={jobLogRef}>
            {jobLogText || (isLoadingJobLog ? 'Loading logs…' : 'No log output yet.')}
          </pre>
          {!followJobLog && (
            <button
              className="deploy-monitor__github-jump"
              onClick={() => {
                setFollowJobLog(true);
                if (jobLogRef.current) jobLogRef.current.scrollTop = jobLogRef.current.scrollHeight;
              }}
              type="button"
            >
              Jump to latest
            </button>
          )}
        </div>
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

function RunStateGlyph({ status, conclusion, small }: { status: string; conclusion: string | null; small?: boolean }) {
  const size = small ? 12 : 14;
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 className="deploy-monitor__glyph deploy-monitor__glyph--success" size={size} />;
    if (conclusion === 'skipped') return <Circle className="deploy-monitor__glyph deploy-monitor__glyph--pending" size={size} />;
    return <XCircle className="deploy-monitor__glyph deploy-monitor__glyph--error" size={size} />;
  }
  if (status === 'in_progress') return <Loader2 className="deploy-monitor__glyph deploy-monitor__glyph--active deploy-monitor__spin" size={size} />;
  return <Circle className="deploy-monitor__glyph deploy-monitor__glyph--pending" size={size} />;
}

function runStateLabel(status: string, conclusion: string | null) {
  if (status === 'completed') {
    if (conclusion === 'success') return 'Succeeded';
    if (conclusion === 'cancelled') return 'Cancelled';
    if (conclusion === 'skipped') return 'Skipped';
    return 'Failed';
  }
  if (status === 'in_progress') return 'Running…';
  if (status === 'queued' || status === 'waiting' || status === 'requested' || status === 'pending') return 'Queued…';
  return status;
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
