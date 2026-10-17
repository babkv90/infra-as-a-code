import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Cloud, GitBranch, Layers, Plus, RefreshCw, Workflow } from 'lucide-react';
import { getStoredUser } from '../../auth/authClient';
import { canUseApplicationPipelines } from '../../utils/accessControl';
import { listDeployments, type DeploymentRecord } from '../../utils/deploymentApi';
import { listSavedDiagrams, type SavedDiagram } from '../diagramApi';
import type { DashboardPage } from '../dashboardData';
import { useUiExperience } from '../../ui/UiExperience';
import { MomentumWorkspaceActions } from './MomentumWorkspaceActions';

/** Uses the existing workspace-scoped clients. No prototype fixtures or extra mutation paths. */
export function StudioWorkspaceSummary({ navigate }: { navigate: (page: DashboardPage) => void }) {
  const { experience } = useUiExperience();
  const [diagrams, setDiagrams] = useState<SavedDiagram[] | null>(null);
  const [deployments, setDeployments] = useState<DeploymentRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getStoredUser();
  const refresh = useCallback(async (isCurrent: () => boolean = () => true) => {
    setLoading(true);
    const [saved, runs] = await Promise.allSettled([listSavedDiagrams(), listDeployments()]);
    if (!isCurrent()) return;
    setDiagrams(saved.status === 'fulfilled' ? saved.value : null);
    setDeployments(runs.status === 'fulfilled' ? runs.value : null);
    setError([saved.status === 'rejected' ? 'Saved architectures could not be loaded.' : '', runs.status === 'rejected' ? 'Deployment history could not be loaded.' : ''].filter(Boolean).join(' '));
    setLoading(false);
  }, []);

  useEffect(() => { let current = true; void refresh(() => current); return () => { current = false; }; }, [refresh]);
  function openDiagram(id: string) {
    navigate('builder');
    const url = new URL(window.location.href);
    url.searchParams.set('diagram', id);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }
  const recent = [...(diagrams ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 3);
  const latest = [...(deployments ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
  return <section className="studio-workspace-summary" aria-label="Workspace overview">
    <div className="studio-welcome">
      <div><span className="studio-eyebrow">{user?.workspaceName || 'YOUR WORKSPACE'} / {experience === 'momentum' ? 'YOUR CLOUD SPACE' : 'ARCHITECTURE STUDIO'}</span><h2>{experience === 'momentum' ? 'Make your next move.' : 'Your cloud. A clearer perspective.'}</h2><p>Design the architecture, ship your application, and see what happens next.</p></div>
      <button className="studio-primary" type="button" onClick={() => navigate('builder')}><Plus size={17} />Open visual builder</button>
    </div>
    <div className="studio-summary-stats" aria-busy={loading}>
      <div><span><Layers size={16} />Saved architectures</span><strong>{loading ? '…' : diagrams?.length ?? '—'}</strong><small>From your workspace</small></div>
      <div><span><Cloud size={16} />Deployed infrastructure</span><strong>{loading ? '…' : deployments?.filter(run => run.status === 'deployed').length ?? '—'}</strong><small>Infrastructure status, separate from app health</small></div>
      <div><span><Activity size={16} />Latest infrastructure run</span><strong className="studio-run-status">{loading ? 'Loading…' : deployments === null ? 'Unavailable' : latest?.status.replace(/_/g, ' ') || 'No runs yet'}</strong><small>{latest?.name || 'Your next change starts in the builder'}</small></div>
    </div>
    {experience === 'momentum' && <MomentumWorkspaceActions diagram={recent[0]} navigate={navigate} openDiagram={openDiagram} />}
    <div className="studio-project-heading"><div><span className="studio-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h3>Your architectures</h3></div><button className="studio-text-button" disabled={loading} onClick={() => void refresh()} type="button"><RefreshCw size={14} />Refresh</button></div>
    {error && <div className="studio-data-error" role="status">{error} Use Refresh to retry.</div>}
    <div className="studio-project-grid">
      {loading ? <p className="studio-empty">Loading saved architectures…</p> : recent.length ? recent.map(diagram => <button className="studio-project-card" type="button" key={diagram._id} onClick={() => openDiagram(diagram._id)}><span className="studio-project-icon"><Workflow size={22} /></span><strong>{diagram.name}</strong><span>{diagram.nodes?.length ?? 0} resources <i>·</i> {diagram.activeRegion || 'Region not set'}</span><small>{diagram.updatedAt ? `Saved ${new Date(diagram.updatedAt).toLocaleDateString()}` : 'Saved architecture'}<ArrowRight size={15} /></small></button>) : !error && <div className="studio-empty"><Workflow size={25} /><strong>A new architecture starts here.</strong><p>Open the builder to choose a template or create a blank diagram.</p><button className="studio-text-button" onClick={() => navigate('builder')} type="button">Start designing<ArrowRight size={15} /></button></div>}
      {canUseApplicationPipelines(user) && <button className="studio-project-card studio-app-entry" type="button" onClick={() => navigate('app-pipeline')}><span className="studio-project-icon"><GitBranch size={22} /></span><strong>Bring your application.</strong><span>Connect a repository to your infrastructure.</span><small>Open application pipelines<ArrowRight size={15} /></small></button>}
    </div>
  </section>;
}
