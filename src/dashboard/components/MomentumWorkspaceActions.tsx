import { Activity, ArrowRight, Cloud, Layers, Workflow, type LucideIcon } from 'lucide-react';
import { getStoredUser } from '../../auth/authClient';
import { isSuperAdmin } from '../../utils/accessControl';
import type { DashboardPage } from '../dashboardData';
import type { SavedDiagram } from '../diagramApi';

/** The reference's continue card and shortcuts, connected to this workspace's modules. */
export function MomentumWorkspaceActions({ diagram, navigate, openDiagram }: {
  diagram?: SavedDiagram;
  navigate: (page: DashboardPage) => void;
  openDiagram: (id: string) => void;
}) {
  const admin = isSuperAdmin(getStoredUser());
  const shortcuts: { page: DashboardPage; icon: LucideIcon; title: string; copy: string }[] = [
    { page: 'deployments', icon: Cloud, title: 'Your deployments', copy: 'Follow infrastructure changes and deployment status.' },
    admin
      ? { page: 'ai-agent', icon: Activity, title: 'AI Cloud Agent', copy: 'Explore your architecture and plan the next change.' }
      : { page: 'resource-info', icon: Activity, title: 'Your cloud resources', copy: 'Explore inventory and activity in your AWS account.' },
    admin
      ? { page: 'support', icon: Layers, title: 'Workspace support', copy: 'Get help and follow your support requests.' }
      : { page: 'connect-aws', icon: Layers, title: 'Connect AWS', copy: 'Connect your account and review its sync status.' },
  ];

  return <div className="momentum-actions">
    <article className="momentum-continue">
      <span className="studio-eyebrow">CONTINUE BUILDING</span>
      <div className="momentum-continue-body">
        <span className="momentum-architecture-icon"><Workflow size={48} strokeWidth={1.5} /></span>
        <div>
          <h3>{diagram?.name || 'Your next big idea starts here.'}</h3>
          <p>{diagram ? `${diagram.nodes?.length ?? 0} resources · ${diagram.activeRegion || 'Choose a region'}` : 'Design visually. Review the code. Build with confidence.'}</p>
        </div>
      </div>
      <button type="button" onClick={() => diagram ? openDiagram(diagram._id) : navigate('builder')}>
        {diagram ? 'Continue architecture' : 'Open visual builder'}<ArrowRight size={18} />
      </button>
      <small>Your architecture. Your AWS account.</small>
    </article>
    <div className="momentum-shortcuts">
      {shortcuts.map(({ page, icon: Icon, title, copy }) => <button key={page} type="button" onClick={() => navigate(page)}>
        <span className="studio-project-icon"><Icon size={23} /></span>
        <span><strong>{title}</strong><small>{copy}</small></span>
        <ArrowRight size={17} />
      </button>)}
    </div>
  </div>;
}
