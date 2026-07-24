import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import Editor from '@monaco-editor/react';
import {
  Activity,
  ArrowRight,
  AlertTriangle,
  BadgeDollarSign,
  Bell,
  BrainCircuit,
  CheckCircle2,
  CloudCog,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FilePlus2,
  GitBranch,
  Github,
  LifeBuoy,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  Network,
  Paperclip,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { useReactFlow } from 'reactflow';
import Canvas from '../components/Canvas';
import AppLogo from '../components/AppLogo';
import DeploymentModal from '../components/DeploymentModal';
import PropertiesPanel from '../components/PropertiesPanel';
import ResourceInfoViewer from '../components/ResourceInfoViewer';
import Sidebar from '../components/Sidebar';
import StatusBar from '../components/StatusBar';
import Toolbar from '../components/Toolbar';
import { getStoredUser, logout } from '../auth/authClient';
import { isEnterpriseDemoDiagram, loadDemoDiagrams } from '../data/enterpriseDemoSource';
import { useDiagramStore } from '../store/diagramStore';
import { normalizeTerraformFiles } from '../utils/importDiagram';
import { createSavedDiagram, deleteSavedDiagram, listSavedDiagrams, updateSavedDiagram, type SavedDiagram } from './diagramApi';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import {
  activeDiagrams,
  agentActions,
  awsConnectionSteps,
  awsOverviewCharts,
  connectedAccount,
  costRecommendations,
  commonDeploymentTemplates,
  commonInfraTemplates,
  dashboardKpis,
  dashboardNavItems,
  deploymentPipeline,
  resourceInventory,
  securityFindings,
  terraformCode,
  terraformFiles,
  type DashboardPage,
} from './dashboardData';
import {
  connectAwsAccount,
  disconnectAwsAccount,
  getAwsInsights,
  getDeployerIdentity,
  listAwsAccounts,
  listAwsRegions,
  syncAwsAccount,
  type AwsAccountRecord,
  type AwsInsights,
} from './awsApi';
import { buildDeployRoleTrustPolicy, deployRolePermissionsPolicy } from './deployRolePolicy';
import { createAgentConversation, sendAgentMessage, type AgentConversation } from './agentApi';
import {
  getSuperAdminOverview,
  grantSuperAdminCredits,
  requestDemoCredits,
  updateSuperAdminUserRole,
  type SuperAdminOverview,
  type SuperAdminUser,
} from './superAdminApi';
import {
  createApplicationPipeline,
  deployApplicationPipeline,
  getApplicationDeploymentStatus,
  listApplicationPipelines,
  reportPipelineRunResult,
  syncPipelineToGithub,
  type ApplicationDeploymentStatus,
  type ApplicationPipelineRecord,
} from './applicationPipelineApi';
import { listNotifications, markAllNotificationsRead, type NotificationRecord } from './notificationApi';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  addTicketComment,
  createTicket,
  fetchTicketAttachmentBlobUrl,
  getTicket,
  listTickets,
  updateTicketStatus,
  type TicketAttachment,
  type TicketCategory,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from './ticketApi';
import {
  disconnectGithub,
  getGithubStatus,
  githubOAuthUrl,
  listGithubBranches,
  listGithubRepositories,
  type GithubBranch,
  type GithubConnection,
  type GithubRepository,
} from '../github/githubApi';
import {
  getNodeRuntimeSnapshot,
  runNodeConceptDemo,
  type NodeConceptRun,
  type NodeLabIntensity,
  type NodeLabMode,
  type NodeRuntimeSnapshot,
} from './nodeLabApi';
import { destroyDeployment, forceDestroyDeployment, getDeployment, listDeployments, type DeploymentRecord } from '../utils/deploymentApi';
import { buildDeploymentResourceBundle } from '../utils/resourceRequirements';
import type { ValidationIssue } from '../utils/validate';
import { canUseAiAgent, canUseApplicationPipelines, serviceAccessTierForUser } from '../utils/accessControl';

const NODE_LAB_MODES: Array<{ mode: NodeLabMode; label: string; description: string }> = [
  {
    mode: 'worker-thread',
    label: 'Worker thread',
    description: 'Runs CPU-heavy JavaScript away from the main request path.',
  },
  {
    mode: 'child-process',
    label: 'Child process',
    description: 'Starts isolated Node work with its own process ID.',
  },
  {
    mode: 'cluster',
    label: 'Cluster',
    description: 'Splits work across multiple short-lived process workers.',
  },
];

type RuntimeLabDetail = {
  title: string;
  subtitle: string;
  process: string;
  realTimeExample: string;
  steps: string[];
  codePath?: string;
};

const dashboardPageIds = new Set<DashboardPage>(dashboardNavItems.map((item) => item.id));

function getInitialDashboardPage(): DashboardPage {
  const page = new URLSearchParams(window.location.search).get('view') as DashboardPage | null;
  return page && dashboardPageIds.has(page) ? page : 'overview';
}

function getDashboardUrl(page: DashboardPage) {
  return page === 'overview' ? '/dashboard' : `/dashboard?view=${page}`;
}

const templateDiagramPrefix = 'template:';

function templateDiagramId(templateId: string) {
  return `${templateDiagramPrefix}${templateId}`;
}

function DashboardShell({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [activePage, setActivePage] = useState<DashboardPage>(getInitialDashboardPage);
  const [awsAccounts, setAwsAccounts] = useState<AwsAccountRecord[]>([]);
  const [awsInsights, setAwsInsights] = useState<AwsInsights | undefined>();
  const [awsRegions, setAwsRegions] = useState<string[]>(['ap-south-1']);
  const [awsDataError, setAwsDataError] = useState('');
  const [awsDataMessage, setAwsDataMessage] = useState('');
  const [isSyncingAws, setIsSyncingAws] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const currentUser = getStoredUser();
  const visibleNavItems = useMemo(
    () =>
      dashboardNavItems.filter((item) => {
        if (item.id === 'ai-agent') return canUseAiAgent(currentUser);
        if (item.id === 'app-pipeline') return canUseApplicationPipelines(currentUser);
        if (item.id === 'super-admin') return currentUser?.role === 'superadmin';
        return true;
      }),
    [currentUser],
  );
  const activeItem = useMemo(() => visibleNavItems.find((item) => item.id === activePage), [activePage, visibleNavItems]);
  const activeAwsAccount = awsAccounts.find((account) => account.status === 'connected') ?? awsAccounts[0];
  const accountStatusClass = activeAwsAccount?.status ?? 'offline';

  function goToDashboardPage(page: DashboardPage) {
    setActivePage(page);
    window.history.replaceState(null, '', getDashboardUrl(page));
  }

  function goToResourceInfo(deploymentId: string) {
    setActivePage('resource-info');
    window.history.replaceState(null, '', `/dashboard?view=resource-info&deployment=${encodeURIComponent(deploymentId)}`);
  }

  async function handleLogout() {
    await logout();
    window.location.href = '/';
  }

  async function refreshAwsData() {
    try {
      const [accounts, insights, regions] = await Promise.all([listAwsAccounts(), getAwsInsights(), listAwsRegions()]);
      setAwsAccounts(accounts);
      setAwsInsights(insights);
      setAwsRegions(regions);
      setAwsDataError('');
    } catch (error) {
      setAwsDataError(error instanceof Error ? error.message : 'Unable to load AWS data');
    }
  }

  async function refreshNotifications() {
    try {
      const result = await listNotifications();
      setNotifications(result.notifications);
      setUnreadNotificationCount(result.unreadCount);
    } catch {
      // Notification polling failures should stay silent; the bell simply won't update this cycle.
    }
  }

  async function openNotifications() {
    setIsNotificationsOpen((open) => !open);
    if (unreadNotificationCount > 0) {
      try {
        await markAllNotificationsRead();
        setNotifications((current) => current.map((item) => ({ ...item, read: true })));
        setUnreadNotificationCount(0);
      } catch {
        // Leave unread state as-is if the mark-all-read call fails; the next poll will retry the fetch.
      }
    }
  }

  async function syncActiveAwsAccount() {
    if (!activeAwsAccount || isSyncingAws) return;

    setAwsDataError('');
    setAwsDataMessage('');
    setIsSyncingAws(true);

    try {
      const syncedAccount = await syncAwsAccount(activeAwsAccount._id);
      await refreshAwsData();
      setAwsDataMessage(`${syncedAccount.name} synced with live AWS data.`);
    } catch (error) {
      setAwsDataError(error instanceof Error ? error.message : 'Unable to sync AWS data');
    } finally {
      setIsSyncingAws(false);
    }
  }

  useEffect(() => {
    void refreshAwsData();
  }, []);

  useEffect(() => {
    if (!awsDataMessage) return;
    const timer = window.setTimeout(() => setAwsDataMessage(''), 5000);
    return () => window.clearTimeout(timer);
  }, [awsDataMessage]);

  useEffect(() => {
    if (!awsDataError) return;
    const timer = window.setTimeout(() => setAwsDataError(''), 5000);
    return () => window.clearTimeout(timer);
  }, [awsDataError]);

  useEffect(() => {
    void refreshNotifications();
    const interval = window.setInterval(() => {
      void refreshNotifications();
    }, 15000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <a className="dash-brand" href="/">
          <AppLogo className="app-logo--dashboard" />
        </a>
        <div className="dash-sidebar-actions">
          <button aria-label="New Diagram" className="dash-new-button" onClick={() => goToDashboardPage('builder')} title="New Diagram">
            <Plus size={15} />
          </button>
        </div>
        <nav className="dash-nav">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={activePage === item.id ? 'active' : ''} key={item.id} onClick={() => goToDashboardPage(item.id)} title={item.label}>
                <Icon size={17} />
                <span>{item.label}</span>
                {item.badge && <i>{item.badge}</i>}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="dash-main">
        <header className="dash-topbar">
          <div>
            <span className="dash-eyebrow">Post-login dashboard</span>
            <h1>{activeItem?.label ?? 'Dashboard'}</h1>
          </div>
          <div className="dash-top-actions">
            <label className="dash-search">
              <Search size={16} />
              <input placeholder="Search diagrams, resources, Terraform..." />
            </label>
            <div
              className={`dash-account-status dash-account-status--${accountStatusClass}`}
              title={`${activeAwsAccount?.name ?? connectedAccount.accountName} - ${activeAwsAccount?.status ?? connectedAccount.syncStatus}`}
            >
              <span />
              <div>
                <strong>{activeAwsAccount?.name ?? connectedAccount.accountName}</strong>
                <small>{activeAwsAccount ? `${activeAwsAccount.status}${activeAwsAccount.lastSyncAt ? ` - synced` : ''}` : connectedAccount.syncStatus}</small>
              </div>
            </div>
            <div className="dash-notifications">
              <button className="dash-icon-button" onClick={() => void openNotifications()} title="Notifications" type="button">
                <Bell size={17} />
                {unreadNotificationCount > 0 && <span className="dash-notification-badge">{unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}</span>}
              </button>
              {isNotificationsOpen && (
                <div className="dash-notification-panel">
                  <div className="dash-notification-panel-header">
                    <strong>Notifications</strong>
                    <button className="dash-icon-button" onClick={() => setIsNotificationsOpen(false)} title="Close" type="button">
                      <X size={14} />
                    </button>
                  </div>
                  {notifications.length ? (
                    <ul className="dash-notification-list">
                      {notifications.map((item) => (
                        <li className={`dash-notification-item dash-notification-item--${item.status}`} key={item._id}>
                          {item.status === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                          <div>
                            <strong>{item.title}</strong>
                            {item.message && <p>{item.message}</p>}
                            {item.errorLog && (
                              <pre className="dash-notification-log">{item.errorLog}</pre>
                            )}
                            <small>{new Date(item.createdAt).toLocaleString()}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dash-notification-empty">No deployment activity yet.</p>
                  )}
                </div>
              )}
            </div>
            <button className="dash-icon-button" onClick={onToggleTheme} title={getThemeToggleTitle(theme)}>
              {theme === 'dark' ? <Sun size={17} /> : theme === 'light' ? <Sparkles size={17} /> : <Moon size={17} />}
            </button>
            <a className="dash-secondary-action" href="/settings">
              <Settings size={16} />
              Settings
            </a>
            <button className="dash-secondary-action" onClick={() => void handleLogout()} type="button">
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </header>
        {awsDataError && <div className="dash-global-error">{awsDataError}</div>}
        {awsDataMessage && <div className="dash-global-success">{awsDataMessage}</div>}
        <div className="dash-content">
          {renderPage(activePage, goToDashboardPage, {
            awsAccounts,
            awsInsights,
            awsRegions,
            onAwsChanged: refreshAwsData,
            onSyncAws: syncActiveAwsAccount,
            isSyncingAws,
          }, theme, onToggleTheme, goToResourceInfo)}
        </div>
      </section>
    </div>
  );
}

type DashboardAwsContext = {
  awsAccounts: AwsAccountRecord[];
  awsInsights?: AwsInsights;
  awsRegions: string[];
  onAwsChanged: () => Promise<void>;
  onSyncAws: () => Promise<void>;
  isSyncingAws: boolean;
};

function renderPage(
  activePage: DashboardPage,
  setActivePage: (page: DashboardPage) => void,
  awsContext: DashboardAwsContext,
  theme: ThemeMode,
  onToggleTheme: () => void,
  onViewResourceInfo: (deploymentId: string) => void,
) {
  switch (activePage) {
    case 'builder':
      return <VisualBuilderPage theme={theme} onToggleTheme={onToggleTheme} />;
    case 'terraform':
      return <TerraformPage />;
    case 'ai-agent':
      return <AgentPage />;
    case 'deployments':
      return (
        <DeploymentsPage
          insights={awsContext.awsInsights}
          isSyncingAws={awsContext.isSyncingAws}
          onSyncAws={awsContext.onSyncAws}
          onViewResourceInfo={onViewResourceInfo}
        />
      );
    case 'resource-info':
      return <ResourceInfoPage />;
    case 'app-pipeline':
      return <ApplicationPipelinePage />;
    case 'security':
      return <SecurityPage insights={awsContext.awsInsights} />;
    case 'runtime-lab':
      return <RuntimeLabPage />;
    case 'connect-aws':
      return <ConnectAwsPage accounts={awsContext.awsAccounts} regions={awsContext.awsRegions} onAwsChanged={awsContext.onAwsChanged} />;
    case 'support':
      return <SupportPage />;
    case 'super-admin':
      return <SuperAdminPage />;
    default:
      return <OverviewPage setActivePage={setActivePage} insights={awsContext.awsInsights} isSyncingAws={awsContext.isSyncingAws} onSyncAws={awsContext.onSyncAws} />;
  }
}

function OverviewPage({
  setActivePage,
  insights,
  isSyncingAws,
  onSyncAws,
}: {
  setActivePage: (page: DashboardPage) => void;
  insights?: AwsInsights;
  isSyncingAws: boolean;
  onSyncAws: () => Promise<void>;
}) {
  return (
    <div className="dash-page dash-page--overview">
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Cloud operations</span>
            <h2>Overview</h2>
          </div>
          <div className="pipeline-header-badges">
            <button className="pipeline-link-button" onClick={() => setActivePage('connect-aws')} type="button">
              Connect AWS Account
              <ExternalLink size={14} />
            </button>
            <button className="pipeline-primary-compact" disabled={isSyncingAws} onClick={() => void onSyncAws()} type="button">
              <CloudCog size={14} />
              {isSyncingAws ? 'Syncing AWS...' : 'Sync live AWS data'}
            </button>
            <button className="pipeline-primary-compact" onClick={() => setActivePage('builder')} type="button">
              Start Building
              <ArrowRight size={14} />
            </button>
          </div>
        </header>
      </div>

      <div className="dash-overview-scroll">
        {insights && <PermissionErrorList insights={insights} />}
        <KpiGrid insights={insights} />

        <OverviewAwsGraphs insights={insights} />

        {insights && (
          <div className="dash-two-col dash-two-col--wide">
            <Panel title="Resource inventory" action={insights.syncedAt ? `Synced ${new Date(insights.syncedAt).toLocaleString()}` : 'No live sync'}>
              <ResourceTable insights={insights} />
            </Panel>
            <Panel title="Recent AWS events" action="CloudTrail">
              <RecentAwsEvents insights={insights} />
            </Panel>
          </div>
        )}

        {insights ? (
          <Panel title="Cost Explorer by service" action="Current month">
            <BillingServiceTable insights={insights} />
          </Panel>
        ) : (
          <EmptyState>Connect AWS to load live AWS insights and Cost Explorer billing data.</EmptyState>
        )}

        <CostRecommendationGrid insights={insights} />

        <Panel title="Active diagrams" action="View all">
          <div className="dash-list">
            {activeDiagrams.length ? (
              activeDiagrams.map((diagram) => (
                <div className="dash-list-row" key={diagram.name}>
                  <div>
                    <strong>{diagram.name}</strong>
                    <span>{diagram.resources} resources - {diagram.updated}</span>
                  </div>
                  <em>{diagram.status}</em>
                </div>
              ))
            ) : (
              <EmptyState>No diagrams yet. Start building to create your first architecture.</EmptyState>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function OverviewAwsGraphs({ insights }: { insights?: AwsInsights }) {
  const charts = buildOverviewCharts(insights);
  return (
    <section className="dash-overview-graphs">
      {charts.map((chart) => (
        <article className={`dash-overview-chart dash-overview-chart--${chart.tone}`} key={chart.title}>
          <header>
            <div>
              <span>{chart.title}</span>
              <strong>{chart.metric}</strong>
            </div>
            <em>{chart.caption}</em>
          </header>
          <div className="dash-overview-bars">
            {chart.data.map((item) => (
              <div className="dash-overview-bar-row" key={item.label}>
                <span>{item.label}</span>
                <div>
                  <i style={{ width: `${item.value}%` }} />
                </div>
                <strong>{formatOverviewChartValue(chart.title, item.value)}</strong>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function buildOverviewCharts(insights?: AwsInsights) {
  if (!insights) return awsOverviewCharts;

  const costItems = insights.billing.byService.length
    ? insights.billing.byService.slice(0, 5).map((item) => ({ label: item.service.replace('Amazon ', '').slice(0, 14), value: Math.round(item.cost) }))
    : awsOverviewCharts[0].data;

  return [
    {
      title: 'Cost by service',
      metric: `$${insights.billing.monthlySpend.toFixed(2)}`,
      caption: 'Current month AWS spend',
      tone: 'cyan',
      data: costItems,
    },
    {
      title: 'Lambda invocations',
      metric: String(insights.resources.failedInvocations ?? 0),
      caption: 'Failed invocations found',
      tone: 'violet',
      data: [
        { label: 'Failed', value: Number(insights.resources.failedInvocations ?? 0) },
        { label: 'Functions', value: Number(insights.resources.lambdaFunctions ?? 0) },
      ],
    },
    {
      title: 'Resource health',
      metric: String(Number(insights.resources.securityWarnings ?? 0) === 0 ? '0 warnings' : `${insights.resources.securityWarnings} warnings`),
      caption: 'Security and alarm signals',
      tone: 'emerald',
      data: [
        { label: 'Alarms', value: Number(insights.resources.securityWarnings ?? 0) },
        { label: 'Idle', value: Number(insights.resources.idleResources ?? 0) },
      ],
    },
    {
      title: 'Optimization queue',
      metric: `$${insights.billing.estimatedSavings}/mo`,
      caption: 'Estimated savings available',
      tone: 'amber',
      data: [
        { label: 'Idle', value: Number(insights.resources.idleResources ?? 0) },
        { label: 'Actions', value: insights.recommendations.length },
      ],
    },
  ];
}

function formatOverviewChartValue(title: string, value: number) {
  if (title === 'Cost by service') return `$${value}`;
  if (title === 'Lambda invocations') return `${value}`;
  return `${value}%`;
}

function VisualBuilderPage({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const terraformFileRef = useRef<HTMLInputElement>(null);
  const builderShellRef = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isServicePanelCollapsed, setIsServicePanelCollapsed] = useState(false);
  const [isDeploymentPageOpen, setIsDeploymentPageOpen] = useState(false);
  const [updateDeploymentId, setUpdateDeploymentId] = useState<string>();
  const [demoDiagrams, setDemoDiagrams] = useState<SavedDiagram[]>([]);
  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>([]);
  const [currentDiagramId, setCurrentDiagramId] = useState<string>();
  const [currentDiagramName, setCurrentDiagramName] = useState('Untitled diagram');
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [isSavingDiagram, setIsSavingDiagram] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState('');
  const [creditMessage, setCreditMessage] = useState('');
  const { nodes, edges, issues, activeRegion, validate, setDark, importDiagram, markSaved } = useDiagramStore();
  const user = getStoredUser();
  const canWriteDiagrams = canRoleWriteDiagrams(user?.role);
  const canDeleteDiagrams = canRoleDeleteDiagrams(user?.role);
  const accessTier = serviceAccessTierForUser(user);
  const directoryDiagrams = useMemo(() => [...demoDiagrams, ...savedDiagrams], [demoDiagrams, savedDiagrams]);
  const hasOpenableDiagrams = commonInfraTemplates.length > 0 || directoryDiagrams.length > 0;
  const isCurrentTemplateDiagram = currentDiagramId?.startsWith(templateDiagramPrefix) ?? false;

  function fitFullDiagram() {
    const fit = () => flow.fitView({ padding: 0.12, maxZoom: 1.1 });
    requestAnimationFrame(fit);
    window.setTimeout(fit, 220);
  }

  async function toggleBuilderFullscreen() {
    const nextFullscreen = !isFullscreen;
    setIsFullscreen(nextFullscreen);

    try {
      if (nextFullscreen && builderShellRef.current?.requestFullscreen && !document.fullscreenElement) {
        await builderShellRef.current.requestFullscreen();
      } else if (!nextFullscreen && document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // CSS fullscreen still works when the browser Fullscreen API is blocked.
    } finally {
      fitFullDiagram();
    }
  }

  useEffect(() => {
    setDark(theme === 'dark');
  }, [setDark, theme]);

  useEffect(() => {
    const syncNativeFullscreen = () => {
      if (!document.fullscreenElement && isFullscreen) setIsFullscreen(false);
    };

    document.addEventListener('fullscreenchange', syncNativeFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncNativeFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    void refreshEnterpriseDemoDiagram();
    void refreshSavedDiagrams();
  }, []);

  useEffect(() => {
    const targetDeploymentId = new URLSearchParams(window.location.search).get('updateDeployment');
    if (!targetDeploymentId) return;

    window.history.replaceState(null, '', '/dashboard?view=builder');

    getDeployment(targetDeploymentId)
      .then((deployment) => {
        importDiagram({ nodes: deployment.diagram?.nodes ?? [], edges: deployment.diagram?.edges ?? [] });
        setCurrentDiagramId(deployment.diagram?._id);
        setCurrentDiagramName(deployment.diagram?.name ?? deployment.name);
        setUpdateDeploymentId(deployment._id);
        setIsDeploymentPageOpen(true);
        fitFullDiagram();
      })
      .catch((error) => {
        setDirectoryMessage(error instanceof Error ? error.message : 'Unable to load that deployment for updating.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshEnterpriseDemoDiagram() {
    try {
      setDemoDiagrams(await loadDemoDiagrams());
    } catch (error) {
      setDirectoryMessage((message) => message || (error instanceof Error ? error.message : 'Unable to load demo diagrams.'));
    }
  }

  async function refreshSavedDiagrams() {
    setIsLoadingDirectory(true);
    setDirectoryMessage('');

    try {
      setSavedDiagrams(await listSavedDiagrams());
    } catch (error) {
      setDirectoryMessage(error instanceof Error ? error.message : 'Unable to load saved diagrams.');
    } finally {
      setIsLoadingDirectory(false);
    }
  }

  async function refreshDiagramDirectory() {
    await Promise.all([refreshEnterpriseDemoDiagram(), refreshSavedDiagrams()]);
  }

  function openSavedDiagram(diagram: SavedDiagram) {
    importDiagram({ nodes: diagram.nodes ?? [], edges: diagram.edges ?? [] });
    setCurrentDiagramId(diagram._id);
    setCurrentDiagramName(diagram.name);
    setDirectoryMessage(`Opened ${diagram.name}`);
    fitFullDiagram();
  }

  function openInfraTemplate(templateId: string) {
    const template = commonInfraTemplates.find((item) => item.id === templateId);
    if (!template) return;

    importDiagram(template.snapshot);
    setCurrentDiagramId(templateDiagramId(template.id));
    setCurrentDiagramName(template.name);
    setDirectoryMessage(`Loaded ${template.name} template.`);
    fitFullDiagram();
  }

  function selectSavedDiagram(diagramId: string) {
    if (diagramId.startsWith(templateDiagramPrefix)) {
      openInfraTemplate(diagramId.slice(templateDiagramPrefix.length));
      return;
    }

    const diagram = directoryDiagrams.find((item) => item._id === diagramId);
    if (diagram) openSavedDiagram(diagram);
  }

  function startBlankDiagram() {
    importDiagram({ nodes: [], edges: [] });
    setCurrentDiagramId(undefined);
    setCurrentDiagramName('Untitled diagram');
    setDirectoryMessage('Started a new unsaved diagram.');
  }

  async function importTerraform(files?: FileList | null) {
    const terraformFilesToRead = Array.from(files ?? []).filter(isTerraformImportFile);
    if (!terraformFilesToRead.length) return;

    try {
      const sources = await Promise.all(terraformFilesToRead.map(readFileAsText));
      const snapshot = normalizeTerraformFiles(sources);
      importDiagram(snapshot);
      setCurrentDiagramId(undefined);
      setCurrentDiagramName(terraformFilesToRead.length === 1 ? terraformFilesToRead[0].name.replace(/\.(tf|hcl|tfvars|json|ya?ml|env)$/i, '') : `Terraform import (${terraformFilesToRead.length} files)`);
      setDirectoryMessage(terraformImportMessage(terraformFilesToRead));
      fitFullDiagram();
    } catch (error) {
      setDirectoryMessage(error instanceof Error ? error.message : 'Unable to import these Terraform files.');
    } finally {
      if (terraformFileRef.current) terraformFileRef.current.value = '';
    }
  }

  async function saveCurrentDiagram() {
    if (!canWriteDiagrams || isSavingDiagram) return;

    const firstSaveName = currentDiagramId ? currentDiagramName : window.prompt('Diagram name', currentDiagramName);
    const name = (firstSaveName ?? '').trim();
    if (!name) return;

    setIsSavingDiagram(true);
    setDirectoryMessage('');

    try {
      const payload = { name, activeRegion, nodes, edges };
      const saved = currentDiagramId && !isEnterpriseDemoDiagram(currentDiagramId) && !isCurrentTemplateDiagram ? await updateSavedDiagram(currentDiagramId, payload) : await createSavedDiagram(payload);
      setCurrentDiagramId(saved._id);
      setCurrentDiagramName(saved.name);
      markSaved();
      setSavedDiagrams(await listSavedDiagrams());
      setDirectoryMessage(`Saved ${saved.name}`);
    } catch (error) {
      setDirectoryMessage(error instanceof Error ? error.message : 'Unable to save this diagram.');
    } finally {
      setIsSavingDiagram(false);
    }
  }

  async function deleteCurrentDiagram() {
    if (!canDeleteDiagrams || !currentDiagramId) return;

    setIsLoadingDirectory(true);
    setDirectoryMessage('');

    try {
      await deleteSavedDiagram(currentDiagramId);
      setIsDeleteDialogOpen(false);
      const diagrams = await listSavedDiagrams();
      setSavedDiagrams(diagrams);
      setCurrentDiagramId(undefined);
      setCurrentDiagramName('Untitled diagram');
      importDiagram({ nodes: [], edges: [] });
      setDirectoryMessage('Diagram deleted.');
    } catch (error) {
      setDirectoryMessage(error instanceof Error ? error.message : 'Unable to delete this diagram.');
    } finally {
      setIsLoadingDirectory(false);
    }
  }

  async function requestMoreCredits() {
    setCreditMessage('');
    try {
      await requestDemoCredits(5, 'Requesting demo credits to test additional Visual Builder resources and services.');
      setCreditMessage('Demo credit request sent to super admin.');
    } catch (error) {
      setCreditMessage(error instanceof Error ? error.message : 'Unable to request demo credits.');
    }
  }

  if (isDeploymentPageOpen) {
    return (
      <div className="dash-page dash-page--builder dash-page--deployment">
        <DeploymentModal
          nodes={nodes}
          edges={edges}
          issues={issues}
          onValidate={validate}
          updateDeploymentId={updateDeploymentId}
          onClose={() => {
            setIsDeploymentPageOpen(false);
            setUpdateDeploymentId(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div className="dash-page dash-page--builder">
      <section className="diagram-directory" aria-label="Saved diagrams directory">
        <header>
          <div>
            <span className="dash-eyebrow">Diagram directory</span>
            <strong>{currentDiagramId ? currentDiagramName : 'Unsaved diagram'}</strong>
          </div>
          <div className="diagram-directory__actions">
            <label className="diagram-directory__select">
              <span>Open</span>
              <select value={currentDiagramId ?? ''} onChange={(event) => selectSavedDiagram(event.target.value)} disabled={isLoadingDirectory || !hasOpenableDiagrams}>
                <option value="">{isLoadingDirectory ? 'Loading diagrams...' : hasOpenableDiagrams ? 'Select diagram or template' : 'No diagrams'}</option>
                {commonInfraTemplates.length > 0 && (
                  <optgroup label="Application templates">
                    {commonInfraTemplates.map((template) => (
                      <option value={templateDiagramId(template.id)} key={template.id}>
                        {template.name} ({template.snapshot.nodes.length} nodes)
                      </option>
                    ))}
                  </optgroup>
                )}
                {directoryDiagrams.length > 0 && (
                  <optgroup label="Saved diagrams">
                    {directoryDiagrams.map((diagram) => (
                      <option value={diagram._id} key={diagram._id}>
                        {diagram.name} ({diagram.nodes?.length ?? 0} nodes)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <button className="dash-secondary-action" onClick={startBlankDiagram} type="button">
              <FilePlus2 size={15} />
              New blank
            </button>
            <button className="dash-secondary-action" disabled={isLoadingDirectory} onClick={() => void refreshDiagramDirectory()} type="button">
              <RefreshCw size={15} />
              Refresh
            </button>
            <button className="dash-secondary-action" onClick={() => terraformFileRef.current?.click()} type="button">
              <Upload size={15} />
              Upload Terraform
            </button>
            <button className="dash-secondary-action" onClick={() => void toggleBuilderFullscreen()} type="button">
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            </button>
            {canDeleteDiagrams && (
              <button
                className="dash-secondary-action diagram-directory__delete"
                disabled={isLoadingDirectory || !currentDiagramId || isEnterpriseDemoDiagram(currentDiagramId) || isCurrentTemplateDiagram}
                onClick={() => setIsDeleteDialogOpen(true)}
                type="button"
              >
                <Trash2 size={15} />
                Delete
              </button>
            )}
          </div>
        </header>
        <input
          ref={terraformFileRef}
          hidden
          multiple
          type="file"
          accept=".tf,.hcl,.tfvars,.env,.json,.yaml,.yml,text/plain,application/json"
          onChange={(event) => void importTerraform(event.target.files)}
        />
        {directoryMessage && <p>{directoryMessage}</p>}
        <p>Access tier: {accessTier}. Locked services cannot be dragged or deployed for this account.</p>
        {user?.role !== 'superadmin' && (user?.workspacePlan === 'demo' || user?.workspacePlan === 'free') && (
          <div className="diagram-directory__credit-row">
            <button className="dash-secondary-action" onClick={() => void requestMoreCredits()} type="button">
              Request demo credits
            </button>
            {creditMessage && <span>{creditMessage}</span>}
          </div>
        )}
      </section>
      <div ref={builderShellRef} className={`dashboard-builder-shell ${isFullscreen ? 'dashboard-builder-shell--fullscreen' : ''}`}>
        {isFullscreen && (
          <div className="dashboard-builder-fullscreen-bar">
            <strong>Visual Builder</strong>
            <button className="dashboard-builder-fullscreen-exit" onClick={() => void toggleBuilderFullscreen()} type="button">
              <Minimize2 size={15} />
              Exit Full Screen
            </button>
          </div>
        )}
        <Toolbar
          theme={theme}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => void toggleBuilderFullscreen()}
          onOpenDeployment={() => setIsDeploymentPageOpen(true)}
          onSaveDiagram={() => void saveCurrentDiagram()}
          canSaveDiagram={canWriteDiagrams}
          isSavingDiagram={isSavingDiagram}
          saveDiagramTitle={canWriteDiagrams ? 'Save diagram to backend' : 'Architect, admin, or owner role required to save diagrams'}
        />
        <div className={`workspace ${isServicePanelCollapsed ? 'workspace--sidebar-collapsed' : ''}`}>
          <Sidebar isCollapsed={isServicePanelCollapsed} onToggleCollapsed={() => setIsServicePanelCollapsed((value) => !value)} user={user} />
          <Canvas />
          <PropertiesPanel />
        </div>
        <StatusBar />
      </div>
      {isDeleteDialogOpen && (
        <div className="diagram-delete-dialog-backdrop" role="presentation" onMouseDown={() => setIsDeleteDialogOpen(false)}>
          <section
            aria-modal="true"
            className="diagram-delete-dialog"
            role="dialog"
            aria-labelledby="delete-diagram-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <span className="dash-eyebrow">Delete diagram</span>
              <h3 id="delete-diagram-title">{currentDiagramName}</h3>
              <p>This saved diagram will be permanently removed from the backend.</p>
            </div>
            <div className="diagram-delete-dialog__actions">
              <button className="dash-secondary-action" onClick={() => setIsDeleteDialogOpen(false)} type="button">
                Cancel
              </button>
              <button className="dash-secondary-action diagram-directory__delete" disabled={isLoadingDirectory} onClick={() => void deleteCurrentDiagram()} type="button">
                <Trash2 size={15} />
                {isLoadingDirectory ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TerraformPage() {
  return (
    <div className="dash-page">
      <div className="dash-inline-actions">
        <button className="dash-secondary-action">
          <Copy size={16} />
          Copy Code
        </button>
        <button className="dash-primary-action">
          <Github size={16} />
          Push to GitHub
        </button>
      </div>
      <div className="dash-two-col dash-two-col--wide" style={{ minHeight: 'calc(100vh - 180px)' }}>
        <Panel title="Generated files" action="Regenerate">
          <div className="dash-file-list">
            {terraformFiles.length ? (
              terraformFiles.map((file) => (
                <div className="dash-file-row" key={file.name}>
                  <Code2Icon />
                  <span>{file.name}</span>
                  <small>{file.lines} lines</small>
                  <em>{file.status}</em>
                </div>
              ))
            ) : (
              <EmptyState>No Terraform files generated yet.</EmptyState>
            )}
          </div>
        </Panel>
        <Panel title="Terraform preview" action="Export .zip">
          <pre className="dash-code-preview">{terraformCode}</pre>
        </Panel>
      </div>
    </div>
  );
}

function AgentPage() {
  const user = getStoredUser();
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, isSending]);

  async function submitMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || isSending) return;

    setDraft('');
    setError('');
    setIsSending(true);

    const optimisticConversation: AgentConversation = conversation ?? {
      _id: 'pending',
      title: cleanMessage.slice(0, 72),
      messages: [],
    };

    setConversation({
      ...optimisticConversation,
      messages: [...optimisticConversation.messages, { role: 'user', content: cleanMessage }],
    });

    try {
      const updatedConversation =
        conversation && conversation._id !== 'pending'
          ? await sendAgentMessage(conversation._id, cleanMessage)
          : await createAgentConversation(cleanMessage);
      setConversation(updatedConversation);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send message to the RAG agent.');
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage(draft);
  }

  async function startNewChat() {
    if (isSending) return;
    setConversation(null);
    setDraft('');
    setError('');
  }

  if (!canUseAiAgent(user)) {
    return (
      <div className="dash-page dash-page--agent">
        <Panel title="AWS Well-Architected RAG agent" action="Paid plan">
          <EmptyState>AI support is available for Pro, Enterprise, and Super admin accounts.</EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="dash-page dash-page--agent">
      <div className="dash-agent-layout">
        <Panel title="AWS Well-Architected RAG agent" action="Live RAG">
          <div className="dash-agent-question-suggestions" aria-label="Suggested questions">
            {agentActions.map((action) => (
              <button disabled={isSending} key={action} onClick={() => void submitMessage(action)} type="button">
                <Sparkles size={15} />
                {action}
              </button>
            ))}
            <button disabled={isSending} onClick={() => void startNewChat()} type="button">
              <FilePlus2 size={15} />
              New chat
            </button>
          </div>
          <div className="dash-chat">
            {conversation?.messages.length ? (
              conversation.messages.map((message, index) => (
                <div className={`dash-chat-bubble dash-chat-bubble--${message.role === 'assistant' ? 'agent' : message.role}`} key={`${message.role}-${index}-${message.createdAt ?? message.content}`}>
                  <p>{message.content}</p>
                  {message.role === 'assistant' && message.metadata?.contexts?.length ? (
                    <div className="dash-chat-sources">
                      {message.metadata.contexts.slice(0, 3).map((context, sourceIndex) => (
                        <span key={context.id}>
                          Source {sourceIndex + 1}: {formatAgentSource(context.metadata)} - score {context.score.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyState>Ask the AWS Well-Architected RAG agent a question.</EmptyState>
            )}
            {isSending && (
              <div className="dash-chat-bubble dash-chat-bubble--agent">
                <p>Retrieving AWS Well-Architected context...</p>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {error && <div className="dash-form-error">{error}</div>}
          <form className="dash-chat-input" onSubmit={handleSubmit}>
            <input
              disabled={isSending}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about reliability, security, cost, operations, or Well-Architected best practices..."
              value={draft}
            />
            <button disabled={isSending || !draft.trim()} type="submit">
              <ArrowRight size={16} />
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function formatAgentSource(metadata?: Record<string, unknown>) {
  const pages = Array.isArray(metadata?.pages) ? metadata.pages.join('-') : undefined;
  const source = typeof metadata?.source === 'string' ? metadata.source.split(/[\\/]/).pop() : 'wellarchitected-framework.pdf';

  return pages ? `${source}, pages ${pages}` : source;
}

function DeploymentsPage({
  insights,
  isSyncingAws,
  onSyncAws,
  onViewResourceInfo,
}: {
  insights?: AwsInsights;
  isSyncingAws: boolean;
  onSyncAws: () => Promise<void>;
  onViewResourceInfo: (deploymentId: string) => void;
}) {
  const [deploymentRecords, setDeploymentRecords] = useState<DeploymentRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'successful' | 'pending' | 'error'>('all');
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const [destroyingDeploymentId, setDestroyingDeploymentId] = useState<string>();
  const [pendingDestroyDeployment, setPendingDestroyDeployment] = useState<DeploymentRecord | null>(null);
  const [forceDestroyingDeploymentId, setForceDestroyingDeploymentId] = useState<string>();
  const [pendingForceDestroyDeployment, setPendingForceDestroyDeployment] = useState<DeploymentRecord | null>(null);
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<string>();
  const [selectedTemplateId, setSelectedTemplateId] = useState(commonDeploymentTemplates[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const visibleDeployments = deploymentRecords.filter((deployment) => statusFilter === 'all' || deploymentStatusGroup(deployment.status) === statusFilter);
  const selectedTemplate = commonDeploymentTemplates.find((template) => template.id === selectedTemplateId) ?? commonDeploymentTemplates[0];
  const counts = deploymentRecords.reduce(
    (acc, deployment) => {
      acc.all += 1;
      acc[deploymentStatusGroup(deployment.status)] += 1;
      return acc;
    },
    { all: 0, successful: 0, pending: 0, error: 0 },
  );

  async function refreshDeployments() {
    setIsLoadingDeployments(true);
    try {
      setDeploymentRecords(await listDeployments());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load deployments.');
    } finally {
      setIsLoadingDeployments(false);
    }
  }

  async function handleDestroy(deployment: DeploymentRecord) {
    setMessage('');
    setError('');
    setDestroyingDeploymentId(deployment._id);

    try {
      const updatedDeployment = await destroyDeployment(deployment._id);
      setDeploymentRecords((records) => records.map((item) => (item._id === updatedDeployment._id ? updatedDeployment : item)));
      setMessage(`Destroy started for ${deployment.name}.`);
      setPendingDestroyDeployment(null);
    } catch (destroyError) {
      setError(destroyError instanceof Error ? destroyError.message : 'Unable to destroy infrastructure.');
    } finally {
      setDestroyingDeploymentId(undefined);
    }
  }

  async function handleForceDestroy(deployment: DeploymentRecord) {
    setMessage('');
    setError('');
    setForceDestroyingDeploymentId(deployment._id);

    try {
      const updatedDeployment = await forceDestroyDeployment(deployment._id);
      setDeploymentRecords((records) => records.map((item) => (item._id === updatedDeployment._id ? updatedDeployment : item)));
      setMessage(`Force destroy started for ${deployment.name}. This cleans up any resources that were created before the deployment appeared stuck.`);
      setPendingForceDestroyDeployment(null);
    } catch (forceDestroyError) {
      setError(forceDestroyError instanceof Error ? forceDestroyError.message : 'Unable to force destroy infrastructure.');
    } finally {
      setForceDestroyingDeploymentId(undefined);
    }
  }

  useEffect(() => {
    void refreshDeployments();
  }, []);

  useEffect(() => {
    const hasActiveDeployment = deploymentRecords.some((deployment) => ['queued', 'deploying', 'destroying'].includes(deployment.status));
    if (!hasActiveDeployment) return undefined;

    const interval = window.setInterval(() => {
      void refreshDeployments();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [deploymentRecords]);

  return (
    <div className="dash-page dash-page--deployments">
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Infrastructure lifecycle</span>
            <h2>Deployments</h2>
          </div>
          <div className="pipeline-header-badges">
            {insights?.syncedAt && <span className="pipeline-badge">Synced {new Date(insights.syncedAt).toLocaleString()}</span>}
            <button className="pipeline-icon-action" disabled={isSyncingAws} onClick={() => void onSyncAws()} title="Sync live usage and billing" type="button">
              <CloudCog size={15} />
            </button>
            <button className="pipeline-icon-action" disabled={isLoadingDeployments} onClick={() => void refreshDeployments()} title="Refresh deployments" type="button">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        {message && <div className="pipeline-notice">{message}</div>}
        {error && <div className="pipeline-notice pipeline-notice--error">{error}</div>}
      </div>

      <section className="admin-kpi-strip">
        {(
          [
            { filter: 'all' as const, icon: Activity },
            { filter: 'successful' as const, icon: CheckCircle2 },
            { filter: 'pending' as const, icon: RefreshCw },
            { filter: 'error' as const, icon: AlertTriangle },
          ]
        ).map(({ filter, icon: Icon }) => (
          <button
            className={`deploy-kpi-card ${statusFilter === filter ? 'active' : ''}`}
            key={filter}
            onClick={() => setStatusFilter(filter)}
            type="button"
          >
            <span className={`admin-kpi-icon ${filter === 'successful' ? 'admin-kpi-icon--success' : filter === 'pending' ? '' : filter === 'error' ? 'admin-kpi-icon--warning' : ''}`}>
              <Icon size={16} />
            </span>
            <div>
              <span>{deploymentFilterLabel(filter)}</span>
              <strong>{counts[filter]}</strong>
            </div>
          </button>
        ))}
      </section>

      <div className="deploy-console-grid">
        <section className="deploy-table-panel">
          <header>
            <strong>Deployed diagrams</strong>
            <span>{visibleDeployments.length} shown</span>
          </header>
          <div className="dash-deploy-table-wrap">
            {visibleDeployments.length ? (
              <table className="dash-deploy-table">
                <thead>
                  <tr>
                    <th>Deployment</th>
                    <th>Status</th>
                    <th>Resources</th>
                    <th>Connections</th>
                    <th>Region</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDeployments.map((deployment) => {
                  const isExpanded = expandedDeploymentId === deployment._id;
                  return (
                    <Fragment key={deployment._id}>
                      <tr className={`dash-deploy-table-row dash-deploy-table-row--${deploymentStatusGroup(deployment.status)} ${isExpanded ? 'active' : ''}`}>
                        <td>
                          <button className="dash-deploy-name-button" onClick={() => setExpandedDeploymentId(isExpanded ? undefined : deployment._id)} type="button">
                            <strong>{deployment.name}</strong>
                            <span>{deployment.diagram?.name ?? 'Saved deployment diagram'}</span>
                          </button>
                        </td>
                        <td>
                          <span className={`dash-deploy-status-pill dash-deploy-status-pill--${deploymentStatusGroup(deployment.status)}`}>
                            {deploymentStatusLabel(deployment.status)}
                          </span>
                          {FORCE_DESTROY_STATUSES.includes(deployment.status) && (
                            <span className={`dash-deploy-elapsed ${isDeploymentStuck(deployment) ? 'dash-deploy-elapsed--stuck' : ''}`}>
                              {isDeploymentStuck(deployment) && <AlertTriangle size={11} />}
                              Running {formatElapsedDuration(deploymentElapsedMs(deployment))}
                            </span>
                          )}
                        </td>
                        <td>{deployment.resourceCount}</td>
                        <td>{deployment.connectionCount}</td>
                        <td>{deployment.diagram?.activeRegion ?? 'region unknown'}</td>
                        <td>{formatDeploymentDate(deployment)}</td>
                        <td>
                          <div className="dash-deploy-table-actions">
                            <button className="dash-secondary-action" onClick={() => setExpandedDeploymentId(isExpanded ? undefined : deployment._id)} type="button">
                              {isExpanded ? 'Hide' : 'Details'}
                            </button>
                            <button className="dash-secondary-action" disabled={isLoadingDeployments} onClick={() => void refreshDeployments()} type="button">
                              <RefreshCw size={15} />
                              Refresh
                            </button>
                            <button
                              className="dash-secondary-action"
                              disabled={!['deployed', 'failed'].includes(deployment.status)}
                              onClick={() => {
                                window.location.href = `/dashboard?view=builder&updateDeployment=${encodeURIComponent(deployment._id)}`;
                              }}
                              title="Edit this deployment's diagram and apply just the changes to the already-running infrastructure."
                              type="button"
                            >
                              <PencilLine size={15} />
                              Update
                            </button>
                            {FORCE_DESTROY_STATUSES.includes(deployment.status) ? (
                              <button
                                className="dash-secondary-action dash-danger-action dash-nowrap-action"
                                disabled={forceDestroyingDeploymentId === deployment._id}
                                onClick={() => setPendingForceDestroyDeployment(deployment)}
                                title="Taking an unusual amount of time? Force destroy cleans up whatever was already created in AWS."
                                type="button"
                              >
                                <AlertTriangle size={15} />
                                {forceDestroyingDeploymentId === deployment._id ? 'Forcing...' : 'Force destroy'}
                              </button>
                            ) : (
                              <button
                                className="dash-secondary-action dash-danger-action"
                                disabled={!canDestroyDeployment(deployment.status) || destroyingDeploymentId === deployment._id}
                                onClick={() => setPendingDestroyDeployment(deployment)}
                                type="button"
                              >
                                <Trash2 size={15} />
                                {destroyingDeploymentId === deployment._id ? 'Destroying...' : 'Destroy'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="dash-deploy-table-detail-row">
                          <td colSpan={7}>
                            <DeploymentTableDetails deployment={deployment} insights={insights} onViewResourceInfo={onViewResourceInfo} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState>No deployments match this status. Deploy a diagram from the visual builder to see it here.</EmptyState>
          )}
        </div>
        </section>

        <aside className="admin-side-col">
          <section className="deploy-side-panel">
            <header>
              <strong>Deployment pipeline</strong>
              <span>Reference</span>
            </header>
            <div className="dash-pipeline">
              {deploymentPipeline.map((step) => {
                const Icon = step.icon;
                return (
                  <div className={`dash-pipeline-step dash-pipeline-step--${step.status}`} key={step.label}>
                    <Icon size={18} />
                    <span>{step.label}</span>
                    <small>{step.status}</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="deploy-side-panel deploy-side-panel--scroll">
            <header>
              <strong>Infrastructure template guide</strong>
              <span>{commonDeploymentTemplates.length} templates</span>
            </header>
            <div className="dash-deploy-template-picker">
              <label>
                <span>Application-compatible infrastructure</span>
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                  {commonDeploymentTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTemplate && (
                <div className="dash-deploy-template-summary">
                  <div>
                    <strong>Compatible apps</strong>
                    <p>{selectedTemplate.compatibility}</p>
                  </div>
                  <div>
                    <strong>Infrastructure</strong>
                    <p>{selectedTemplate.infrastructure}</p>
                  </div>
                  <div>
                    <strong>Application deployment</strong>
                    <p>{selectedTemplate.deploymentPath}</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
      {pendingDestroyDeployment && (
        <div className="dash-destroy-dialog-backdrop" role="presentation" onClick={() => !destroyingDeploymentId && setPendingDestroyDeployment(null)}>
          <section
            aria-labelledby="dash-destroy-dialog-title"
            aria-modal="true"
            className="dash-destroy-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>
                <AlertTriangle size={22} />
              </span>
              <button
                aria-label="Close destroy confirmation"
                className="dash-icon-button"
                disabled={Boolean(destroyingDeploymentId)}
                onClick={() => setPendingDestroyDeployment(null)}
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="dash-destroy-dialog__body">
              <h2 id="dash-destroy-dialog-title">Destroy infrastructure?</h2>
              <p>
                This will run Terraform destroy for <strong>{pendingDestroyDeployment.name}</strong> and remove the AWS infrastructure created by this deployment.
              </p>
              <div className="dash-destroy-dialog__meta">
                <span>{pendingDestroyDeployment.resourceCount} resources</span>
                <span>{pendingDestroyDeployment.connectionCount} connections</span>
                <span>{pendingDestroyDeployment.diagram?.activeRegion ?? 'region unknown'}</span>
              </div>
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={Boolean(destroyingDeploymentId)} onClick={() => setPendingDestroyDeployment(null)} type="button">
                Cancel
              </button>
              <button className="dash-secondary-action dash-danger-action" disabled={Boolean(destroyingDeploymentId)} onClick={() => void handleDestroy(pendingDestroyDeployment)} type="button">
                <Trash2 size={15} />
                {destroyingDeploymentId === pendingDestroyDeployment._id ? 'Destroying...' : 'Destroy infrastructure'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {pendingForceDestroyDeployment && (
        <div className="dash-destroy-dialog-backdrop" role="presentation" onClick={() => !forceDestroyingDeploymentId && setPendingForceDestroyDeployment(null)}>
          <section
            aria-labelledby="dash-force-destroy-dialog-title"
            aria-modal="true"
            className="dash-destroy-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>
                <AlertTriangle size={22} />
              </span>
              <button
                aria-label="Close force destroy confirmation"
                className="dash-icon-button"
                disabled={Boolean(forceDestroyingDeploymentId)}
                onClick={() => setPendingForceDestroyDeployment(null)}
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="dash-destroy-dialog__body">
              <h2 id="dash-force-destroy-dialog-title">Force destroy this deployment?</h2>
              <p>
                <strong>{pendingForceDestroyDeployment.name}</strong> is currently <strong>{deploymentStatusLabel(pendingForceDestroyDeployment.status)}</strong> (running for{' '}
                {formatElapsedDuration(deploymentElapsedMs(pendingForceDestroyDeployment))}). Force destroy skips the normal "already running" guard and attempts to clean up
                any AWS resources already created, so nothing keeps billing in the background.
              </p>
              <p>
                If Terraform is genuinely still applying in the background, this attempt will safely fail with a state-lock error instead of corrupting anything &mdash;
                wait a bit and retry in that case.
              </p>
              <div className="dash-destroy-dialog__meta">
                <span>{pendingForceDestroyDeployment.resourceCount} resources</span>
                <span>{pendingForceDestroyDeployment.connectionCount} connections</span>
                <span>{pendingForceDestroyDeployment.diagram?.activeRegion ?? 'region unknown'}</span>
              </div>
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={Boolean(forceDestroyingDeploymentId)} onClick={() => setPendingForceDestroyDeployment(null)} type="button">
                Cancel
              </button>
              <button
                className="dash-secondary-action dash-danger-action dash-nowrap-action"
                disabled={Boolean(forceDestroyingDeploymentId)}
                onClick={() => void handleForceDestroy(pendingForceDestroyDeployment)}
                type="button"
              >
                <AlertTriangle size={15} />
                {forceDestroyingDeploymentId === pendingForceDestroyDeployment._id ? 'Forcing destroy...' : 'Force destroy'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function ResourceInfoPage() {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeploymentId, setSelectedDeploymentId] = useState(() => new URLSearchParams(window.location.search).get('deployment') ?? '');

  async function refresh() {
    setIsLoading(true);
    try {
      const records = await listDeployments();
      setDeployments(records);
      setSelectedDeploymentId((current) => current || records[0]?._id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load deployments.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredDeployments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) => `${deployment.name} ${deployment.diagram?.name ?? ''}`.toLowerCase().includes(term));
  }, [deployments, searchTerm]);

  const selectedDeployment = deployments.find((deployment) => deployment._id === selectedDeploymentId);
  const nodes = selectedDeployment?.diagram?.nodes ?? [];
  const edges = selectedDeployment?.diagram?.edges ?? [];
  const bundle = useMemo(
    () => buildDeploymentResourceBundle(nodes, edges, (selectedDeployment?.validationIssues ?? []) as ValidationIssue[], selectedDeployment?.outputs),
    [nodes, edges, selectedDeployment?.validationIssues, selectedDeployment?.outputs],
  );

  function selectDeployment(id: string) {
    setSelectedDeploymentId(id);
    window.history.replaceState(null, '', `/dashboard?view=resource-info&deployment=${encodeURIComponent(id)}`);
  }

  return (
    <div className="dash-page dash-page--resource-info">
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Deployed infrastructure</span>
            <h2>Resource Info</h2>
          </div>
          <div className="pipeline-header-badges">
            <span className="pipeline-badge">{deployments.length} deployments</span>
            <button className="pipeline-icon-action" disabled={isLoading} onClick={() => void refresh()} title="Refresh" type="button">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        {error && <div className="pipeline-notice pipeline-notice--error">{error}</div>}
      </div>

      <div className="resource-info-console-grid">
        <aside className="resource-info-list-panel">
          <label className="admin-search resource-info-search">
            <Search size={14} />
            <input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search deployments" value={searchTerm} />
          </label>
          {filteredDeployments.length ? (
            <ul className="resource-info-deployment-list">
              {filteredDeployments.map((deployment) => (
                <li
                  className={`resource-info-deployment-item ${selectedDeploymentId === deployment._id ? 'active' : ''}`}
                  key={deployment._id}
                  onClick={() => selectDeployment(deployment._id)}
                >
                  <div className="resource-info-deployment-item__top">
                    <span className={`dash-deploy-status-pill dash-deploy-status-pill--${deploymentStatusGroup(deployment.status)}`}>
                      {deploymentStatusLabel(deployment.status)}
                    </span>
                  </div>
                  <strong>{deployment.name}</strong>
                  <span>
                    {deployment.resourceCount} resources &middot; {formatDeploymentDate(deployment)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pipeline-muted resource-info-list-empty">{isLoading ? 'Loading deployments...' : 'No deployments yet.'}</p>
          )}
        </aside>

        <section className="resource-info-detail-panel">
          {selectedDeployment ? (
            <ResourceInfoViewer bundle={bundle} fileName={`${selectedDeployment.name}-resource-info.json`} />
          ) : (
            <div className="resource-info-detail-empty">
              <Database size={30} />
              <p>Select a deployment to view every value against the resources it created.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const pipelineAppTypes = [
  { id: 'react-app', label: 'React app' },
  { id: 'node-container', label: 'Node.js container' },
  { id: 'python-api', label: 'Python API' },
  { id: 'java-service', label: 'Java service' },
  { id: 'static-spa', label: 'Static SPA' },
  { id: 'serverless-api', label: 'Serverless API' },
  { id: 'kubernetes-service', label: 'Kubernetes service' },
];

function ApplicationPipelinePage() {
  const user = getStoredUser();
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [pipelines, setPipelines] = useState<ApplicationPipelineRecord[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [name, setName] = useState('Production application pipeline');
  const [appType, setAppType] = useState('react-app');
  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('development');
  const [branch, setBranch] = useState('main');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubConnection, setGithubConnection] = useState<GithubConnection>({ connected: false, login: '', scopes: [] });
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>([]);
  const [githubBranches, setGithubBranches] = useState<GithubBranch[]>([]);
  const [selectedGithubRepo, setSelectedGithubRepo] = useState('');
  const [installCommand, setInstallCommand] = useState('npm ci');
  const [testCommand, setTestCommand] = useState('npm test -- --watch=false');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [startCommand, setStartCommand] = useState('npm start');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGithubBranchesLoading, setIsGithubBranchesLoading] = useState(false);
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<'overview' | 'workflow' | 'files' | 'activity'>('overview');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<ApplicationDeploymentStatus>();
  const [isDeployingApplication, setIsDeployingApplication] = useState(false);
  const [isPollingDeployment, setIsPollingDeployment] = useState(false);
  const [deploymentResultRunId, setDeploymentResultRunId] = useState<number>();
  const [isDeploymentResultOpen, setIsDeploymentResultOpen] = useState(false);
  const githubPopupRef = useRef<Window | null>(null);
  const githubPollRef = useRef<number | undefined>(undefined);
  const selectedPipeline = pipelines.find((pipeline) => pipeline._id === selectedPipelineId) ?? pipelines[0];
  const selectedGithubRepository = githubRepos.find((repo) => repo.fullName === selectedGithubRepo);
  const selectedFile =
    selectedPipeline?.generatedFiles.find((file) => file.path === selectedFilePath) ??
    selectedPipeline?.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml')) ??
    selectedPipeline?.generatedFiles[0];
  const workflowFile =
    selectedPipeline?.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml')) ?? selectedFile;
  const selectedDeployment = deployments.find((deployment) => deployment._id === selectedDeploymentId);
  const validationChecks = buildPipelineValidationChecks({
    selectedPipeline,
    selectedDeployment,
    githubConnection,
    githubOwner,
    githubRepo,
    branch,
    selectedGithubRepository,
  });
  const hasValidationErrors = validationChecks.some((check) => check.status === 'error');
  const hasValidationWarnings = validationChecks.some((check) => check.status === 'warning');
  const validationLabel = hasValidationErrors ? 'Blocked' : hasValidationWarnings ? 'Warnings' : 'Ready';
  const generatedFileCount = selectedPipeline?.generatedFiles.length ?? 0;
  const previewTabs: Array<{ id: typeof activePreviewTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'overview', label: 'Overview', icon: ShieldCheck },
    { id: 'workflow', label: 'Workflow', icon: GitBranch },
    { id: 'files', label: 'Generated Files', icon: FilePlus2 },
    { id: 'activity', label: 'Activity', icon: Activity },
  ];

  async function refreshPipelineData() {
    setIsLoading(true);
    try {
      const [deploymentData, pipelineData] = await Promise.all([listDeployments(), listApplicationPipelines()]);
      setDeployments(deploymentData);
      setPipelines(pipelineData);
      setSelectedDeploymentId((current) => current || deploymentData.find((deployment) => deployment.status === 'deployed')?._id || deploymentData[0]?._id || '');
      setSelectedPipelineId((current) => current || pipelineData[0]?._id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load pipeline data.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshPipelineData();
    void refreshGithubConnection();

    return () => {
      if (githubPollRef.current) window.clearInterval(githubPollRef.current);
    };
  }, []);

  useEffect(() => {
    function handleGithubMessage(event: MessageEvent) {
      if (event.data?.type !== 'infraflow:github-connected') return;
      if (event.data.success) {
        stopGithubPopupPolling();
        setMessage('GitHub connected. Choose a repository and generate or sync the pipeline.');
        setError('');
        void refreshGithubConnection();
      } else {
        setError(event.data.message ?? 'GitHub connection failed.');
      }
    }

    window.addEventListener('message', handleGithubMessage);
    return () => window.removeEventListener('message', handleGithubMessage);
  }, []);

  useEffect(() => {
    if (appType === 'python-api') {
      setInstallCommand('pip install -r requirements.txt');
      setTestCommand('pytest');
      setBuildCommand('python -m compileall .');
      setStartCommand('uvicorn app.main:app --host 0.0.0.0 --port 8080');
    } else if (appType === 'java-service') {
      setInstallCommand('./mvnw -B dependency:go-offline');
      setTestCommand('./mvnw test');
      setBuildCommand('./mvnw -B package');
      setStartCommand('java -jar target/app.jar');
    } else if (appType === 'react-app') {
      setInstallCommand('npm ci');
      setTestCommand('npm test -- --watch=false');
      setBuildCommand('npm run build');
      setStartCommand('npm run preview -- --host 0.0.0.0');
    } else {
      setInstallCommand('npm ci');
      setTestCommand('npm test -- --watch=false');
      setBuildCommand('npm run build');
      setStartCommand(appType === 'static-spa' ? 'npm run preview -- --host 0.0.0.0' : 'npm start');
    }
  }, [appType]);

  useEffect(() => {
    if (!selectedPipeline?.generatedFiles.length) {
      setSelectedFilePath('');
      return;
    }

    if (!selectedPipeline.generatedFiles.some((file) => file.path === selectedFilePath)) {
      const workflow = selectedPipeline.generatedFiles.find((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
      setSelectedFilePath((workflow ?? selectedPipeline.generatedFiles[0]).path);
    }
  }, [selectedFilePath, selectedPipeline]);

  useEffect(() => {
    if (!selectedPipeline || !deploymentStatus?.run || deploymentStatus.run.status === 'completed') return undefined;

    const interval = window.setInterval(() => {
      void refreshApplicationDeploymentStatus({ silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [deploymentStatus?.run?.id, deploymentStatus?.run?.status, selectedPipeline?._id, githubOwner, githubRepo, branch]);

  useEffect(() => {
    const run = deploymentStatus?.run;
    if (deploymentStatus?.statusUnavailable && deploymentResultRunId !== -1) {
      setDeploymentResultRunId(-1);
      setIsDeploymentResultOpen(true);
      return;
    }
    if (!run || run.status !== 'completed' || deploymentResultRunId === run.id) return;
    setDeploymentResultRunId(run.id);
    setIsDeploymentResultOpen(true);
    if (selectedPipeline) {
      // The notification bell (in DashboardShell) polls independently every 15s and will pick this up.
      void reportPipelineRunResult(selectedPipeline._id, {
        runId: run.id,
        runNumber: run.runNumber,
        conclusion: run.conclusion,
        status: run.status,
        htmlUrl: run.htmlUrl,
        owner: deploymentStatus?.repository.owner,
        repo: deploymentStatus?.repository.repo,
        branch: deploymentStatus?.repository.branch,
      });
    }
  }, [deploymentResultRunId, deploymentStatus]);

  async function generatePipeline() {
    setMessage('');
    setError('');
    try {
      const repositoryUrl = githubOwner && githubRepo ? `https://github.com/${githubOwner}/${githubRepo}` : '';
      const pipeline = await createApplicationPipeline({
        name,
        appType,
        environment,
        deploymentId: selectedDeploymentId || undefined,
        repository: { url: repositoryUrl, branch },
        commands: {
          install: installCommand,
          test: testCommand,
          build: buildCommand,
          start: startCommand,
        },
      });
      await refreshPipelineData();
      setSelectedPipelineId(pipeline._id);
      setMessage('Pipeline generated. Add these files to the application repository to deploy on push.');
    } catch (pipelineError) {
      setError(pipelineError instanceof Error ? pipelineError.message : 'Unable to generate application pipeline.');
    }
  }

  function copyFile(file: ApplicationPipelineRecord['generatedFiles'][number]) {
    void navigator.clipboard?.writeText(file.content);
    setMessage(`${file.path} copied.`);
  }

  function chooseGithubRepository(fullName: string, repoSource = githubRepos) {
    setSelectedGithubRepo(fullName);
    const repo = repoSource.find((item) => item.fullName === fullName);
    if (!repo) {
      setGithubOwner('');
      setGithubRepo('');
      setGithubBranches([]);
      return;
    }
    setGithubOwner(repo.owner);
    setGithubRepo(repo.name);
    setBranch(repo.defaultBranch || 'main');
    void syncGithubBranches(repo.owner, repo.name, repo.defaultBranch || 'main');
  }

  async function syncGithubBranches(owner: string, repo: string, preferredBranch = branch) {
    if (!owner || !repo) return;
    setIsGithubBranchesLoading(true);
    try {
      const branches = await listGithubBranches(owner, repo);
      setGithubBranches(branches);
      const selectedBranch = branches.find((item) => item.name === preferredBranch) ?? branches[0];
      if (selectedBranch) setBranch(selectedBranch.name);
      if (!branches.length) setMessage(`GitHub connected to ${owner}/${repo}, but no branches were returned.`);
    } catch (branchError) {
      setGithubBranches([]);
      setError(branchError instanceof Error ? branchError.message : 'Unable to load GitHub branches.');
    } finally {
      setIsGithubBranchesLoading(false);
    }
  }

  async function refreshGithubConnection(options: { silent?: boolean } = {}) {
    if (!options.silent) setIsGithubLoading(true);
    try {
      const connection = await getGithubStatus();
      setGithubConnection(connection);
      if (!connection.connected) {
        setGithubRepos([]);
        setGithubBranches([]);
        setSelectedGithubRepo('');
        setGithubOwner('');
        setGithubRepo('');
        return false;
      }

      const repos = await listGithubRepositories();
      setGithubRepos(repos);
      const preferredRepo = repos.find((repo) => repo.fullName === selectedGithubRepo) ?? repos[0];
      if (preferredRepo) chooseGithubRepository(preferredRepo.fullName, repos);
      if (repos.length === 0) {
        setMessage('GitHub connected, but no repositories were returned for this account or app permission.');
      }
      return true;
    } catch (githubError) {
      setGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
      setGithubBranches([]);
      setSelectedGithubRepo('');
      setGithubOwner('');
      setGithubRepo('');
      if (!options.silent) setError(githubError instanceof Error ? githubError.message : 'Unable to load GitHub connection.');
      return false;
    } finally {
      if (!options.silent) setIsGithubLoading(false);
    }
  }

  function connectGithub() {
    setMessage('');
    setError('');
    const popup = window.open(githubOAuthUrl({ mode: 'popup', returnTo: '/dashboard?view=app-pipeline' }), 'infraflow-github-oauth', 'width=980,height=760');
    if (!popup) {
      setError('Popup blocked. Allow popups for this app, then connect GitHub again.');
      return;
    }
    githubPopupRef.current = popup;
    popup.focus();
    startGithubPopupPolling();
  }

  function startGithubPopupPolling() {
    stopGithubPopupPolling();
    githubPollRef.current = window.setInterval(() => {
      void refreshGithubConnection({ silent: true }).then((connected) => {
        if (connected) {
          stopGithubPopupPolling();
          setMessage('GitHub connected. Choose a repository and generate or sync the pipeline.');
          setError('');
          try {
            githubPopupRef.current?.close();
          } catch {
            // Browser may block programmatic close for some popup states.
          }
        }
      });
    }, 1800);
  }

  function stopGithubPopupPolling() {
    if (!githubPollRef.current) return;
    window.clearInterval(githubPollRef.current);
    githubPollRef.current = undefined;
  }

  async function disconnectGithubAccount() {
    setMessage('');
    setError('');
    try {
      await disconnectGithub();
      setGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
      setGithubBranches([]);
      setSelectedGithubRepo('');
      setGithubOwner('');
      setGithubRepo('');
      setMessage('GitHub disconnected.');
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect GitHub.');
    }
  }

  async function syncSelectedPipeline() {
    if (!selectedPipeline) return;
    if (!githubConnection.connected) {
      setError('Connect GitHub before syncing generated files.');
      return;
    }
    if (!githubOwner || !githubRepo) {
      setError('Choose a GitHub repository before syncing generated files.');
      return;
    }
    setMessage('');
    setError('');
    setIsSyncingGithub(true);
    try {
      const result = await syncPipelineToGithub(selectedPipeline._id, {
        owner: githubOwner,
        repo: githubRepo,
        branch,
      });
      await refreshPipelineData();
      setSelectedPipelineId(result.pipeline._id);
      const oidcSuffix =
        result.oidc?.status === 'provisioned'
          ? ' AWS deploy role provisioned automatically.'
          : result.oidc?.status === 'failed'
            ? ` AWS deploy role setup failed: ${result.oidc.error}`
            : result.oidc?.status === 'skipped'
              ? ` AWS deploy role not auto-provisioned: ${result.oidc.error}`
              : '';
      setMessage(`Synced ${result.sync.files.length} files to GitHub. Latest commit ${result.sync.commitSha.slice(0, 7)}.${oidcSuffix}`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync repository.');
    } finally {
      setIsSyncingGithub(false);
    }
  }

  async function deploySelectedApplication() {
    if (!selectedPipeline) return;
    if (!githubConnection.connected) {
      setError('Connect GitHub before deploying the application.');
      return;
    }
    if (!githubOwner || !githubRepo) {
      setError('Choose a GitHub repository before deploying the application.');
      return;
    }

    setMessage('');
    setError('');
    setIsDeployingApplication(true);
    setActivePreviewTab('activity');
    try {
      const status = await deployApplicationPipeline(selectedPipeline._id, { owner: githubOwner, repo: githubRepo, branch });
      setDeploymentStatus(status);
      setMessage(status.message ?? 'Deployment workflow started.');
      if (status.run?.status !== 'completed') {
        window.setTimeout(() => void refreshApplicationDeploymentStatus({ silent: true }), 2200);
      }
    } catch (deployError) {
      setError(deployError instanceof Error ? deployError.message : 'Unable to start application deployment.');
    } finally {
      setIsDeployingApplication(false);
    }
  }

  async function refreshApplicationDeploymentStatus(options: { silent?: boolean } = {}) {
    if (!selectedPipeline || !githubOwner || !githubRepo) return;
    if (!options.silent) {
      setMessage('');
      setError('');
    }
    setIsPollingDeployment(true);
    try {
      const status = await getApplicationDeploymentStatus(selectedPipeline._id, { owner: githubOwner, repo: githubRepo, branch });
      setDeploymentStatus(status);
      if (!options.silent) setMessage('Deployment status refreshed.');
    } catch (statusError) {
      if (!options.silent) setError(statusError instanceof Error ? statusError.message : 'Unable to refresh deployment status.');
    } finally {
      setIsPollingDeployment(false);
    }
  }

  if (!canUseApplicationPipelines(user)) {
    return (
      <div className="dash-page">
        <Panel title="Application Pipeline" action="Enterprise">
          <EmptyState>Application deployment pipelines are available only for Super admin or Enterprise workspaces.</EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="dash-page dash-page--pipeline">
      <header className="pipeline-console-header">
        <div>
          <span className="dash-eyebrow">CI/CD pipeline builder</span>
          <h2>Create deployment pipeline</h2>
        </div>
        <div className="pipeline-header-badges">
          <span className={`pipeline-badge pipeline-badge--${environment}`}>{environment}</span>
          <span className="pipeline-badge">{selectedPipeline?.target.type ?? selectedDeployment?.status ?? 'No target'}</span>
          <span className={`pipeline-badge ${githubConnection.connected ? 'pipeline-badge--success' : 'pipeline-badge--warning'}`}>
            <Github size={13} />
            {githubConnection.connected ? `@${githubConnection.login}` : 'GitHub not connected'}
          </span>
          <button className="pipeline-icon-action" disabled={isLoading} onClick={() => void refreshPipelineData()} title="Refresh pipelines" type="button">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {(message || error) && (
        <div className={`pipeline-notice ${error ? 'pipeline-notice--error' : 'pipeline-notice--success'}`}>
          {error || message}
        </div>
      )}

      <nav className="pipeline-stepper" aria-label="Pipeline steps">
        {buildPipelineSteps(validationChecks, selectedPipeline).map((step, index) => (
          <div className={`pipeline-stepper-item pipeline-stepper-item--${step.status}`} key={step.label}>
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </nav>

      <div className="pipeline-console-grid">
        <aside className="pipeline-config-panel">
          <section className="pipeline-section">
            <header>
              <strong>Pipeline configuration</strong>
              <span>{generatedFileCount ? `${generatedFileCount} generated files` : 'Not generated'}</span>
            </header>
            <div className="pipeline-field-grid">
              <label className="pipeline-field pipeline-field--wide">
                <span>Pipeline name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="pipeline-field">
                <span>Application type</span>
                <select value={appType} onChange={(event) => setAppType(event.target.value)}>
                  {pipelineAppTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field">
                <span>Environment</span>
                <select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}>
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Infrastructure target</span>
                <select value={selectedDeploymentId} onChange={(event) => setSelectedDeploymentId(event.target.value)}>
                  <option value="">Auto detect from app type</option>
                  {deployments.map((deployment) => (
                    <option key={deployment._id} value={deployment._id}>
                      {deployment.name} ({deployment.status})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="pipeline-section">
            <header>
              <strong>Source</strong>
              {githubConnection.connected ? (
                <button className="pipeline-link-button" onClick={() => void disconnectGithubAccount()} type="button">
                  Disconnect
                </button>
              ) : (
                <button className="pipeline-primary-compact" onClick={connectGithub} type="button">
                  <Github size={14} />
                  Connect GitHub
                </button>
              )}
            </header>
            {githubConnection.connected ? (
              <div className="pipeline-github-account">
                {githubConnection.avatarUrl && <img alt="" src={githubConnection.avatarUrl} />}
                <span>Connected as {githubConnection.login}</span>
              </div>
            ) : (
              <p className="pipeline-muted">Connect GitHub to select a repository and sync generated workflow files.</p>
            )}
            {githubConnection.connected && !hasGithubWorkflowScope(githubConnection) && (
              <div className="pipeline-inline-warning">
                <AlertTriangle size={14} />
                <span>Workflow permission is missing. Reconnect GitHub before syncing workflow files.</span>
                <button onClick={connectGithub} type="button">Reconnect</button>
              </div>
            )}
            <div className="pipeline-source-grid">
              <label className="pipeline-field">
                <span>Repository</span>
                <select
                  disabled={!githubConnection.connected || isGithubLoading || githubRepos.length === 0}
                  value={selectedGithubRepo}
                  onChange={(event) => chooseGithubRepository(event.target.value)}
                >
                  <option value="">{isGithubLoading ? 'Loading repositories...' : 'Choose repository'}</option>
                  {githubRepos.map((repo) => (
                    <option key={repo.id} value={repo.fullName}>
                      {repo.fullName}{repo.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field">
                <span>Branch</span>
                <select disabled={!githubOwner || !githubRepo || isGithubBranchesLoading} value={branch} onChange={(event) => setBranch(event.target.value)}>
                  <option value="">{isGithubBranchesLoading ? 'Loading branches...' : 'Choose branch'}</option>
                  {branch && !githubBranches.some((item) => item.name === branch) && <option value={branch}>{branch}</option>}
                  {githubBranches.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}{item.protected ? ' (protected)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedGithubRepository && (
              <p className="pipeline-muted">
                Repository access: {selectedGithubRepository.permissions?.push ? 'user can push' : 'user cannot push'}. Sync requires Contents write permission.
              </p>
            )}
          </section>

          <section className="pipeline-section">
            <header>
              <strong>Build commands</strong>
              <span>{appType}</span>
            </header>
            <div className="pipeline-command-grid">
              <label className="pipeline-field">
                <span>Install</span>
                <input value={installCommand} onChange={(event) => setInstallCommand(event.target.value)} />
              </label>
              <label className="pipeline-field">
                <span>Test</span>
                <input value={testCommand} onChange={(event) => setTestCommand(event.target.value)} />
              </label>
              <label className="pipeline-field">
                <span>Build</span>
                <input value={buildCommand} onChange={(event) => setBuildCommand(event.target.value)} />
              </label>
              <label className="pipeline-field">
                <span>Start</span>
                <input value={startCommand} onChange={(event) => setStartCommand(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="pipeline-section pipeline-accordion">
            <button className="pipeline-accordion-trigger" onClick={() => setIsAdvancedOpen((current) => !current)} type="button">
              <span>Advanced options</span>
              <RefreshCw className={isAdvancedOpen ? 'pipeline-accordion-icon open' : 'pipeline-accordion-icon'} size={14} />
            </button>
            {isAdvancedOpen && (
              <div className="pipeline-advanced-grid">
                <label className="pipeline-field">
                  <span>Owner</span>
                  <input value={githubOwner} onChange={(event) => setGithubOwner(event.target.value)} placeholder="github-owner" />
                </label>
                <label className="pipeline-field">
                  <span>Repository name</span>
                  <input value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} placeholder="repo-name" />
                </label>
                <label className="pipeline-field pipeline-field--wide">
                  <span>Workflow path</span>
                  <input readOnly value={selectedPipeline?.repository.workflowPath ?? '.github/workflows/infraflow-development-deploy.yml'} />
                </label>
              </div>
            )}
          </section>
        </aside>

        <main className="pipeline-preview-panel">
          {selectedPipeline ? (
            <>
              <section className="pipeline-summary-strip">
                <div>
                  <span>Pipeline</span>
                  <strong>{selectedPipeline.name}</strong>
                </div>
                <div>
                  <span>Target</span>
                  <strong>{selectedPipeline.target.type} / {selectedPipeline.target.region}</strong>
                </div>
                <div>
                  <span>Trigger</span>
                  <strong>{selectedPipeline.repository.branch || branch || 'main'}</strong>
                </div>
                <div>
                  <span>Last sync</span>
                  <strong>{selectedPipeline.repository.lastSyncedAt ? selectedPipeline.repository.lastSyncCommit?.slice(0, 7) : 'Pending'}</strong>
                </div>
                <div title={selectedPipeline.awsDeployRole?.error || selectedPipeline.awsDeployRole?.arn || ''}>
                  <span>AWS deploy role</span>
                  <strong>
                    <span className={`status-pill status-pill--${awsDeployRolePillVariant(selectedPipeline.awsDeployRole?.status)}`}>
                      {awsDeployRoleLabel(selectedPipeline.awsDeployRole?.status)}
                    </span>
                  </strong>
                </div>
              </section>

              <div className="pipeline-tabs" role="tablist">
                {previewTabs.map(({ id, label, icon: Icon }) => (
                  <button
                    className={activePreviewTab === id ? 'active' : ''}
                    key={id}
                    onClick={() => setActivePreviewTab(id)}
                    type="button"
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

              <section className="pipeline-tab-body">
                {activePreviewTab === 'overview' && (
                  <div className="pipeline-check-grid">
                    {validationChecks.map((check) => (
                      <div className={`pipeline-check pipeline-check--${check.status}`} key={check.label}>
                        {check.status === 'success' ? <CheckCircle2 size={16} /> : check.status === 'error' ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                        <div>
                          <strong>{check.label}</strong>
                          <span>{check.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activePreviewTab === 'workflow' && (
                  <div className="pipeline-code-pane">
                    <header>
                      <div>
                        <strong>{workflowFile?.path ?? 'Workflow not generated'}</strong>
                        <span>{workflowFile?.purpose ?? 'GitHub Actions deployment workflow'}</span>
                      </div>
                      {workflowFile && (
                        <button className="pipeline-link-button" onClick={() => copyFile(workflowFile)} type="button">
                          <Copy size={14} />
                          Copy
                        </button>
                      )}
                    </header>
                    <div className="pipeline-monaco">
                      <Editor
                        defaultLanguage="yaml"
                        height="100%"
                        options={{
                          automaticLayout: true,
                          fontSize: 12,
                          lineNumbers: 'on',
                          minimap: { enabled: false },
                          readOnly: true,
                          scrollBeyondLastLine: false,
                          wordWrap: 'on',
                        }}
                        theme="vs-dark"
                        value={workflowFile?.content ?? ''}
                      />
                    </div>
                  </div>
                )}

                {activePreviewTab === 'files' && (
                  <div className="pipeline-files-layout">
                    <div className="pipeline-file-tree">
                      {selectedPipeline.generatedFiles.map((file) => (
                        <button className={selectedFile?.path === file.path ? 'active' : ''} key={file.path} onClick={() => setSelectedFilePath(file.path)} type="button">
                          <FilePlus2 size={14} />
                          <span>{file.path}</span>
                        </button>
                      ))}
                    </div>
                    <div className="pipeline-code-pane">
                      <header>
                        <div>
                          <strong>{selectedFile?.path ?? 'No file selected'}</strong>
                          <span>{selectedFile?.purpose ?? 'Generated deployment artifact'}</span>
                        </div>
                        {selectedFile && (
                          <button className="pipeline-link-button" onClick={() => copyFile(selectedFile)} type="button">
                            <Copy size={14} />
                            Copy
                          </button>
                        )}
                      </header>
                      <div className="pipeline-monaco pipeline-monaco--files">
                        <Editor
                          defaultLanguage={getEditorLanguage(selectedFile?.path)}
                          height="100%"
                          options={{
                            automaticLayout: true,
                            fontSize: 12,
                            lineNumbers: 'on',
                            minimap: { enabled: false },
                            readOnly: true,
                            scrollBeyondLastLine: false,
                            wordWrap: 'on',
                          }}
                          theme="vs-dark"
                          value={selectedFile?.content ?? ''}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activePreviewTab === 'activity' && (
                  <div className="pipeline-activity-list">
                    <section className="pipeline-live-run">
                      <header>
                        <div>
                          <strong>Application deployment</strong>
                          <span>{deploymentStatus?.repository ? `${deploymentStatus.repository.owner}/${deploymentStatus.repository.repo}:${deploymentStatus.repository.branch}` : 'No deployment run started yet'}</span>
                        </div>
                        {deploymentStatus?.dispatchMode && (
                          <em className="pipeline-dispatch-mode">
                            {deploymentStatus.dispatchMode === 'push_trigger' ? 'Push trigger' : 'Workflow dispatch'}
                          </em>
                        )}
                        <button className="pipeline-link-button" disabled={!selectedPipeline || !githubOwner || !githubRepo || isPollingDeployment} onClick={() => void refreshApplicationDeploymentStatus()} type="button">
                          <RefreshCw size={14} />
                          {isPollingDeployment ? 'Refreshing' : 'Refresh'}
                        </button>
                      </header>
                      {deploymentStatus?.statusUnavailable ? (
                        <div className="pipeline-status-unavailable">
                          <AlertTriangle size={16} />
                          <div>
                            <strong>Status unavailable</strong>
                            <span>{deploymentStatus.statusMessage}</span>
                          </div>
                        </div>
                      ) : deploymentStatus?.run ? (
                        <>
                          <div className={`pipeline-run-status pipeline-run-status--${deploymentStatus.run.conclusion ?? deploymentStatus.run.status ?? 'queued'}`}>
                            <span />
                            <strong>Run #{deploymentStatus.run.runNumber ?? deploymentStatus.run.id}</strong>
                            <em>{deploymentStatus.run.conclusion ?? deploymentStatus.run.status}</em>
                            <small>{deploymentStatus.run.commitSha?.slice(0, 7) ?? 'No commit'}</small>
                          </div>
                          <div className="pipeline-job-list">
                            {(deploymentStatus.jobs ?? []).length ? (
                              deploymentStatus.jobs?.map((job) => (
                                <details className={`pipeline-job pipeline-job--${job.conclusion ?? job.status ?? 'queued'}`} key={job.id} open={job.status !== 'completed'}>
                                  <summary>
                                    <span />
                                    <strong>{job.name}</strong>
                                    <em>{job.conclusion ?? job.status}</em>
                                  </summary>
                                  <div>
                                    {(job.steps ?? []).map((step) => (
                                      <p key={`${job.id}-${step.number}-${step.name}`}>
                                        <span>{step.conclusion ?? step.status}</span>
                                        {step.name}
                                      </p>
                                    ))}
                                  </div>
                                </details>
                              ))
                            ) : (
                              <p className="pipeline-muted">GitHub accepted the workflow dispatch. Jobs will appear here when the run starts.</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="pipeline-muted">Click Deploy Application to start the workflow and watch progress here.</p>
                      )}
                    </section>

                    {buildPipelineActivity(selectedPipeline, deploymentStatus).map((item) => (
                      <div className={`pipeline-activity-item pipeline-activity-item--${item.status}`} key={item.label}>
                        <span />
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </div>
                        <em>{item.time}</em>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            <EmptyState>Generate a pipeline to see GitHub Actions, Docker, and deployment files.</EmptyState>
          )}
        </main>
      </div>

      <footer className="pipeline-action-bar">
        <div className={`pipeline-validation-status pipeline-validation-status--${validationLabel.toLowerCase()}`}>
          <span />
          {validationLabel}
          <small>{validationChecks.filter((check) => check.status === 'success').length}/{validationChecks.length} checks</small>
        </div>
        <div>
          <button className="dash-secondary-action" onClick={() => void generatePipeline()} type="button">
            Save Draft
          </button>
          <button className="dash-secondary-action" onClick={() => void generatePipeline()} type="button">
            <RefreshCw size={15} />
            Regenerate
          </button>
          <button
            className="dash-secondary-action"
            disabled={!selectedPipeline || !githubConnection.connected || !githubOwner || !githubRepo || isSyncingGithub}
            onClick={() => void syncSelectedPipeline()}
            type="button"
          >
            <Github size={15} />
            {isSyncingGithub ? 'Syncing...' : 'Sync to GitHub'}
          </button>
          <button
            className="dash-primary-action"
            disabled={!selectedPipeline || hasValidationErrors || isDeployingApplication}
            onClick={() => void deploySelectedApplication()}
            type="button"
          >
            <Rocket size={15} />
            {isDeployingApplication ? 'Starting deployment...' : 'Deploy Application'}
          </button>
        </div>
      </footer>

      {isDeploymentResultOpen && deploymentStatus && (deploymentStatus.run || deploymentStatus.statusUnavailable) && (
        <div className="pipeline-result-backdrop" role="dialog" aria-modal="true" aria-label="Deployment result">
          <section className={`pipeline-result-modal pipeline-result-modal--${deploymentStatus.statusUnavailable ? 'warning' : deploymentStatus.run?.conclusion ?? 'completed'}`}>
            <header>
              <div>
                <span>
                  {deploymentStatus.statusUnavailable
                    ? 'Deployment triggered'
                    : deploymentStatus.run?.conclusion === 'success'
                      ? 'Deployment succeeded'
                      : 'Deployment failed'}
                </span>
                <h3>{deploymentStatus.run ? `Run #${deploymentStatus.run.runNumber ?? deploymentStatus.run.id}` : 'Status unavailable'}</h3>
                <p>
                  {deploymentStatus.repository.owner}/{deploymentStatus.repository.repo} on {deploymentStatus.repository.branch}
                </p>
              </div>
              <button className="pipeline-result-close" onClick={() => setIsDeploymentResultOpen(false)} type="button" aria-label="Close deployment result">
                <X size={16} />
              </button>
            </header>
            <div className="pipeline-result-summary">
              <div>
                <span>Status</span>
                <strong>{deploymentStatus.statusUnavailable ? 'Triggered' : deploymentStatus.run?.conclusion ?? deploymentStatus.run?.status}</strong>
              </div>
              <div>
                <span>Commit</span>
                <strong>{deploymentStatus.run?.commitSha?.slice(0, 7) ?? 'Unknown'}</strong>
              </div>
              <div>
                <span>Trigger</span>
                <strong>{deploymentStatus.dispatchMode === 'push_trigger' ? 'Push trigger' : 'Workflow dispatch'}</strong>
              </div>
            </div>
            {deploymentStatus.statusUnavailable && (
              <div className="pipeline-status-unavailable">
                <AlertTriangle size={16} />
                <div>
                  <strong>GitHub Actions status cannot be read</strong>
                  <span>{deploymentStatus.statusMessage}</span>
                </div>
              </div>
            )}
            <div className="pipeline-result-jobs">
              {(deploymentStatus.jobs ?? []).map((job) => (
                <details className={`pipeline-job pipeline-job--${job.conclusion ?? job.status ?? 'queued'}`} key={job.id} open={job.conclusion !== 'success'}>
                  <summary>
                    <span />
                    <strong>{job.name}</strong>
                    <em>{job.conclusion ?? job.status}</em>
                  </summary>
                  <div>
                    {(job.steps ?? []).map((step) => (
                      <p key={`${job.id}-${step.number}-${step.name}`}>
                        <span>{step.conclusion ?? step.status}</span>
                        {step.name}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={isPollingDeployment} onClick={() => void refreshApplicationDeploymentStatus()} type="button">
                <RefreshCw size={15} />
                {isPollingDeployment ? 'Refreshing...' : 'Refresh status'}
              </button>
              <button className="dash-primary-action" onClick={() => setIsDeploymentResultOpen(false)} type="button">
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

type PipelineCheckStatus = 'success' | 'warning' | 'pending' | 'error';

type PipelineValidationCheck = {
  label: string;
  detail: string;
  status: PipelineCheckStatus;
};

function buildPipelineValidationChecks({
  selectedPipeline,
  selectedDeployment,
  githubConnection,
  githubOwner,
  githubRepo,
  branch,
  selectedGithubRepository,
}: {
  selectedPipeline?: ApplicationPipelineRecord;
  selectedDeployment?: DeploymentRecord;
  githubConnection: GithubConnection;
  githubOwner: string;
  githubRepo: string;
  branch: string;
  selectedGithubRepository?: GithubRepository;
}): PipelineValidationCheck[] {
  return [
    {
      label: 'Application profile',
      detail: selectedPipeline ? `${selectedPipeline.appType} pipeline generated` : 'Generate the pipeline definition',
      status: selectedPipeline ? 'success' : 'pending',
    },
    {
      label: 'Source repository',
      detail: githubConnection.connected && githubOwner && githubRepo ? `${githubOwner}/${githubRepo} on ${branch || 'main'}` : 'Connect GitHub and select a repository',
      status: githubConnection.connected && githubOwner && githubRepo ? 'success' : 'pending',
    },
    {
      label: 'Repository write access',
      detail: selectedGithubRepository ? (selectedGithubRepository.permissions?.push ? 'Push permission detected' : 'Connected account cannot push to this repository') : 'Repository permissions not checked yet',
      status: selectedGithubRepository ? (selectedGithubRepository.permissions?.push ? 'success' : 'error') : 'pending',
    },
    {
      label: 'Infrastructure target',
      detail: selectedDeployment ? `${selectedDeployment.name} is ${selectedDeployment.status}` : selectedPipeline ? `${selectedPipeline.target.type} target selected` : 'Select already-created AWS infrastructure',
      status: selectedDeployment ? (selectedDeployment.status === 'deployed' ? 'success' : 'warning') : selectedPipeline ? 'warning' : 'pending',
    },
    {
      label: 'Generated workflow',
      detail: selectedPipeline?.generatedFiles.some((file) => file.path.includes('.github/workflows/'))
        ? selectedPipeline.repository.workflowPath
        : 'Workflow file will appear after generation',
      status: selectedPipeline?.generatedFiles.some((file) => file.path.includes('.github/workflows/')) ? 'success' : 'pending',
    },
    {
      label: 'GitHub sync',
      detail: selectedPipeline?.repository.lastSyncedAt
        ? `Synced ${new Date(selectedPipeline.repository.lastSyncedAt).toLocaleString()}`
        : 'Sync generated files before relying on push deploys',
      status: selectedPipeline?.repository.lastSyncedAt ? 'success' : 'warning',
    },
  ];
}

function awsDeployRoleLabel(status?: string) {
  switch (status) {
    case 'provisioned':
      return 'Provisioned';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Not synced yet';
  }
}

function awsDeployRolePillVariant(status?: string) {
  switch (status) {
    case 'provisioned':
      return 'running';
    case 'failed':
      return 'stopped';
    default:
      return 'unknown';
  }
}

function buildPipelineSteps(checks: PipelineValidationCheck[], selectedPipeline?: ApplicationPipelineRecord) {
  const sourceReady = checks.some((check) => check.label === 'Source repository' && check.status === 'success');
  const infraReady = checks.some((check) => check.label === 'Infrastructure target' && check.status === 'success');
  const workflowReady = checks.some((check) => check.label === 'Generated workflow' && check.status === 'success');
  const synced = checks.some((check) => check.label === 'GitHub sync' && check.status === 'success');

  return [
    { label: 'Application', status: selectedPipeline ? 'complete' : 'active' },
    { label: 'Source', status: sourceReady ? 'complete' : selectedPipeline ? 'active' : 'pending' },
    { label: 'Build', status: workflowReady ? 'complete' : sourceReady ? 'active' : 'pending' },
    { label: 'Infrastructure', status: infraReady ? 'complete' : workflowReady ? 'active' : 'pending' },
    { label: 'Review & Deploy', status: synced ? 'complete' : infraReady ? 'active' : 'pending' },
  ];
}

function buildPipelineActivity(pipeline: ApplicationPipelineRecord, deploymentStatus?: ApplicationDeploymentStatus) {
  return [
    {
      label: 'Pipeline generated',
      detail: `${pipeline.generatedFiles.length} files prepared for ${pipeline.appType}`,
      status: 'success',
      time: pipeline.createdAt ? new Date(pipeline.createdAt).toLocaleString() : 'Current draft',
    },
    {
      label: 'GitHub sync',
      detail: pipeline.repository.lastSyncedAt
        ? `${pipeline.repository.workflowPath} synced to ${pipeline.repository.branch}`
        : 'Generated files have not been synced to GitHub yet',
      status: pipeline.repository.lastSyncedAt ? 'success' : 'warning',
      time: pipeline.repository.lastSyncedAt ? new Date(pipeline.repository.lastSyncedAt).toLocaleString() : 'Pending',
    },
    {
      label: 'Deployment trigger',
      detail: pipeline.repository.lastSyncCommit ? `Ready from commit ${pipeline.repository.lastSyncCommit.slice(0, 7)}` : 'Push or run workflow after sync',
      status: pipeline.repository.lastSyncCommit ? 'success' : 'pending',
      time: pipeline.updatedAt ? new Date(pipeline.updatedAt).toLocaleString() : 'Pending',
    },
    {
      label: 'Application deployment',
      detail: deploymentStatus?.run
        ? `Workflow ${deploymentStatus.run.status}${deploymentStatus.run.conclusion ? `: ${deploymentStatus.run.conclusion}` : ''}`
        : 'Deployment has not been started from infraflow yet',
      status: deploymentStatus?.run?.conclusion === 'failure' || deploymentStatus?.run?.conclusion === 'cancelled'
        ? 'error'
        : deploymentStatus?.run
          ? 'success'
          : 'pending',
      time: deploymentStatus?.run?.updatedAt ? new Date(deploymentStatus.run.updatedAt).toLocaleString() : 'Pending',
    },
  ];
}

function getEditorLanguage(pathName = '') {
  if (pathName.endsWith('.yml') || pathName.endsWith('.yaml')) return 'yaml';
  if (pathName.endsWith('.json')) return 'json';
  if (pathName.endsWith('.ts') || pathName.endsWith('.tsx')) return 'typescript';
  if (pathName.endsWith('.js') || pathName.endsWith('.jsx')) return 'javascript';
  if (pathName.toLowerCase().includes('dockerfile')) return 'dockerfile';
  if (pathName.endsWith('.md')) return 'markdown';
  return 'text';
}

const TICKET_FILTER_TABS: Array<{ value: TicketStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

function SupportPage() {
  const currentUser = getStoredUser();
  const isSuperAdmin = currentUser?.role === 'superadmin';

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string>();
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail>();
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('other');
  const [newPriority, setNewPriority] = useState<TicketPriority>('medium');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  const [replyMessage, setReplyMessage] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  async function refreshTickets(status: TicketStatus | 'all' = statusFilter) {
    setIsLoadingList(true);
    try {
      const result = await listTickets(status);
      setTickets(result);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load tickets.');
    } finally {
      setIsLoadingList(false);
    }
  }

  useEffect(() => {
    void refreshTickets(statusFilter);
  }, [statusFilter]);

  async function openTicket(id: string) {
    setSelectedTicketId(id);
    setIsLoadingDetail(true);
    setError('');
    try {
      const detail = await getTicket(id);
      setSelectedTicket(detail);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load this ticket.');
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function submitNewTicket() {
    if (!newSubject.trim() || !newDescription.trim()) {
      setError('Subject and description are required.');
      return;
    }
    setIsSubmittingTicket(true);
    setError('');
    try {
      const ticket = await createTicket({
        subject: newSubject.trim(),
        description: newDescription.trim(),
        category: newCategory,
        priority: newPriority,
        files: newFiles,
      });
      setIsNewTicketOpen(false);
      setNewSubject('');
      setNewDescription('');
      setNewCategory('other');
      setNewPriority('medium');
      setNewFiles([]);
      setMessage(`Ticket ${ticket.ticketNumber} submitted. Our team will follow up here.`);
      await refreshTickets();
      await openTicket(ticket._id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit ticket.');
    } finally {
      setIsSubmittingTicket(false);
    }
  }

  async function submitReply(eventArg: React.FormEvent) {
    eventArg.preventDefault();
    if (!selectedTicketId || !replyMessage.trim()) return;
    setIsSubmittingReply(true);
    setError('');
    try {
      const detail = await addTicketComment(selectedTicketId, { message: replyMessage.trim(), files: replyFiles });
      setSelectedTicket(detail);
      setReplyMessage('');
      setReplyFiles([]);
      await refreshTickets();
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Unable to send reply.');
    } finally {
      setIsSubmittingReply(false);
    }
  }

  async function changeStatus(nextStatus: TicketStatus) {
    if (!selectedTicketId || !selectedTicket || nextStatus === selectedTicket.status) return;
    setIsChangingStatus(true);
    setError('');
    try {
      const detail = await updateTicketStatus(selectedTicketId, nextStatus);
      setSelectedTicket(detail);
      await refreshTickets();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update ticket status.');
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function openAttachment(attachment: TicketAttachment) {
    try {
      const url = await fetchTicketAttachmentBlobUrl(attachment);
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : 'Unable to open attachment.');
    }
  }

  return (
    <div className="dash-page dash-page--support">
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Feedback & support</span>
            <h2>{isSuperAdmin ? 'Support inbox' : 'Support tickets'}</h2>
          </div>
          <div className="pipeline-header-badges">
            <span className="pipeline-badge">{tickets.filter((ticket) => ticket.status === 'open').length} open</span>
            <button className="pipeline-icon-action" disabled={isLoadingList} onClick={() => void refreshTickets()} title="Refresh" type="button">
              <RefreshCw size={15} />
            </button>
            <button className="pipeline-primary-compact" onClick={() => setIsNewTicketOpen(true)} type="button">
              <Plus size={14} />
              New ticket
            </button>
          </div>
        </header>

        {(message || error) && <div className={`pipeline-notice ${error ? 'pipeline-notice--error' : 'pipeline-notice--success'}`}>{error || message}</div>}
      </div>

      <div className="ticket-console-grid">
        <aside className="ticket-list-panel">
          <div className="ticket-filter-tabs">
            {TICKET_FILTER_TABS.map((tab) => (
              <button className={statusFilter === tab.value ? 'active' : ''} key={tab.value} onClick={() => setStatusFilter(tab.value)} type="button">
                {tab.label}
              </button>
            ))}
          </div>
          {tickets.length ? (
            <ul className="ticket-list">
              {tickets.map((ticket) => (
                <li
                  className={`ticket-list-item ${selectedTicketId === ticket._id ? 'active' : ''}`}
                  key={ticket._id}
                  onClick={() => void openTicket(ticket._id)}
                >
                  <div className="ticket-list-item-top">
                    <span className={`ticket-status-pill ticket-status-pill--${ticket.status}`}>{ticketStatusLabel(ticket.status)}</span>
                    <span className="ticket-number">{ticket.ticketNumber}</span>
                  </div>
                  <strong>{ticket.subject}</strong>
                  <div className="ticket-list-item-meta">
                    {isSuperAdmin && ticket.createdBy && <span>{ticket.createdBy.name}</span>}
                    <span className={`ticket-priority ticket-priority--${ticket.priority}`}>{ticket.priority}</span>
                    <span>{formatTicketDate(ticket.lastActivityAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pipeline-muted ticket-list-empty">{isLoadingList ? 'Loading tickets...' : 'No tickets yet. Create one to reach the support team.'}</p>
          )}
        </aside>

        <section className="ticket-detail-panel">
          {isLoadingDetail ? (
            <p className="pipeline-muted">Loading ticket...</p>
          ) : !selectedTicket ? (
            <div className="ticket-detail-empty">
              <LifeBuoyIcon />
              <p>Select a ticket from the list, or create a new one to reach the support team.</p>
            </div>
          ) : (
            <>
              <header className="ticket-detail-header">
                <div>
                  <span className="ticket-number">{selectedTicket.ticketNumber}</span>
                  <h3>{selectedTicket.subject}</h3>
                  <div className="ticket-detail-meta">
                    <span>{ticketCategoryLabel(selectedTicket.category)}</span>
                    <span className={`ticket-priority ticket-priority--${selectedTicket.priority}`}>{selectedTicket.priority}</span>
                    {selectedTicket.createdBy && <span>Opened by {selectedTicket.createdBy.name}</span>}
                    <span>{formatTicketDate(selectedTicket.createdAt)}</span>
                  </div>
                </div>
                {isSuperAdmin ? (
                  <select
                    className="ticket-status-select"
                    disabled={isChangingStatus}
                    onChange={(changeEvent) => void changeStatus(changeEvent.target.value as TicketStatus)}
                    value={selectedTicket.status}
                  >
                    {TICKET_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`ticket-status-pill ticket-status-pill--${selectedTicket.status}`}>{ticketStatusLabel(selectedTicket.status)}</span>
                )}
              </header>

              <div className="ticket-thread">
                <article className="ticket-message">
                  <div className="ticket-message-head">
                    <strong>{selectedTicket.createdBy?.name ?? 'You'}</strong>
                    <small>{formatTicketDate(selectedTicket.createdAt)}</small>
                  </div>
                  <p>{selectedTicket.description}</p>
                  <TicketAttachmentList attachments={selectedTicket.attachments} onOpen={openAttachment} />
                </article>
                {selectedTicket.comments.map((comment) => (
                  <article className={`ticket-message ${comment.authorRole === 'superadmin' ? 'ticket-message--staff' : ''}`} key={comment._id}>
                    <div className="ticket-message-head">
                      <strong>{comment.author?.name ?? 'Unknown'}</strong>
                      {comment.authorRole === 'superadmin' && <span className="ticket-staff-badge">Support</span>}
                      <small>{formatTicketDate(comment.createdAt)}</small>
                    </div>
                    <p>{comment.message}</p>
                    <TicketAttachmentList attachments={comment.attachments} onOpen={openAttachment} />
                  </article>
                ))}
              </div>

              <form className="ticket-reply-form" onSubmit={(formEvent) => void submitReply(formEvent)}>
                <textarea
                  onChange={(changeEvent) => setReplyMessage(changeEvent.target.value)}
                  placeholder={isSuperAdmin ? 'Reply to the user...' : 'Write a reply...'}
                  rows={3}
                  value={replyMessage}
                />
                <div className="ticket-reply-actions">
                  <label className="ticket-file-picker">
                    <Paperclip size={14} />
                    {replyFiles.length ? `${replyFiles.length} file(s) selected` : 'Attach files'}
                    <input hidden multiple onChange={(fileEvent) => setReplyFiles(Array.from(fileEvent.target.files ?? []))} type="file" />
                  </label>
                  <button className="pipeline-primary-compact" disabled={isSubmittingReply || !replyMessage.trim()} type="submit">
                    {isSubmittingReply ? 'Sending...' : 'Send reply'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {isNewTicketOpen && (
        <div className="ticket-modal-backdrop" onClick={() => !isSubmittingTicket && setIsNewTicketOpen(false)} role="presentation">
          <section aria-modal="true" className="ticket-modal" onClick={(clickEvent) => clickEvent.stopPropagation()} role="dialog">
            <header>
              <strong>New support ticket</strong>
              <button className="dash-icon-button" onClick={() => setIsNewTicketOpen(false)} title="Close" type="button">
                <X size={14} />
              </button>
            </header>
            <div className="ticket-form-grid">
              <label className="pipeline-field pipeline-field--wide">
                <span>Subject</span>
                <input onChange={(changeEvent) => setNewSubject(changeEvent.target.value)} placeholder="Short summary of your issue" value={newSubject} />
              </label>
              <label className="pipeline-field">
                <span>Category</span>
                <select onChange={(changeEvent) => setNewCategory(changeEvent.target.value as TicketCategory)} value={newCategory}>
                  {TICKET_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field">
                <span>Priority</span>
                <select onChange={(changeEvent) => setNewPriority(changeEvent.target.value as TicketPriority)} value={newPriority}>
                  {TICKET_PRIORITIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Description</span>
                <textarea
                  onChange={(changeEvent) => setNewDescription(changeEvent.target.value)}
                  placeholder="Describe what's happening, steps to reproduce, and what you expected. Paste error messages or logs here."
                  rows={6}
                  value={newDescription}
                />
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Attachments (screenshots, logs)</span>
                <label className="ticket-file-picker ticket-file-picker--block">
                  <Paperclip size={14} />
                  {newFiles.length ? `${newFiles.length} file(s) selected` : 'Attach images, .log/.txt files, JSON, PDF, or ZIP (max 10MB each)'}
                  <input hidden multiple onChange={(fileEvent) => setNewFiles(Array.from(fileEvent.target.files ?? []))} type="file" />
                </label>
              </label>
            </div>
            <footer>
              <button className="pipeline-link-button" onClick={() => setIsNewTicketOpen(false)} type="button">
                Cancel
              </button>
              <button className="pipeline-primary-compact" disabled={isSubmittingTicket} onClick={() => void submitNewTicket()} type="button">
                {isSubmittingTicket ? 'Submitting...' : 'Submit ticket'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function TicketAttachmentList({ attachments, onOpen }: { attachments: TicketAttachment[]; onOpen: (attachment: TicketAttachment) => void }) {
  if (!attachments.length) return null;
  return (
    <div className="ticket-attachment-list">
      {attachments.map((attachment) => (
        <button className="ticket-attachment-chip" key={attachment._id} onClick={() => onOpen(attachment)} title={attachment.originalName} type="button">
          <Paperclip size={12} />
          <span>{attachment.originalName}</span>
          <small>{formatFileSize(attachment.size)}</small>
        </button>
      ))}
    </div>
  );
}

function LifeBuoyIcon() {
  return <LifeBuoy size={30} />;
}

function ticketStatusLabel(status: TicketStatus) {
  return TICKET_STATUSES.find((option) => option.value === status)?.label ?? status;
}

function ticketCategoryLabel(category: TicketCategory) {
  return TICKET_CATEGORIES.find((option) => option.value === category)?.label ?? category;
}

function formatTicketDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ADMIN_ROLE_OPTIONS = ['viewer', 'devops', 'architect', 'admin', 'owner', 'superadmin'];
const ADMIN_STATUS_OPTIONS = ['active', 'invited', 'disabled'];

function SuperAdminPage() {
  const user = getStoredUser();
  const [overview, setOverview] = useState<SuperAdminOverview>();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [credits, setCredits] = useState('5');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const users = overview?.users ?? [];
  const selectedUser = users.find((candidate) => candidate.id === selectedUserId) ?? users[0];

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((candidate) => {
      if (roleFilter !== 'all' && candidate.role !== roleFilter) return false;
      if (statusFilter !== 'all' && candidate.status !== statusFilter) return false;
      if (term && !`${candidate.name} ${candidate.email}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const kpis = useMemo(
    () => ({
      totalUsers: overview?.totals.users ?? 0,
      activeUsers: users.filter((candidate) => candidate.status === 'active').length,
      diagrams: overview?.totals.diagrams ?? 0,
      deployments: overview?.totals.deployments ?? 0,
      pendingCredits: overview?.totals.pendingCreditRequests ?? 0,
      aiEnabled: users.filter((candidate) => candidate.aiEnabled).length,
    }),
    [overview, users],
  );

  async function refreshOverview() {
    if (user?.role !== 'superadmin') return;
    setIsLoading(true);
    try {
      const data = await getSuperAdminOverview();
      setOverview(data);
      setSelectedUserId((current) => current || data.users[0]?.id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load super admin overview.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshOverview();
  }, []);

  if (user?.role !== 'superadmin') {
    return (
      <div className="dash-page">
        <Panel title="Super Admin" action="Restricted">
          <EmptyState>Only super admins can manage all users, credits, roles, and platform activity.</EmptyState>
        </Panel>
      </div>
    );
  }

  async function changeRole(target: SuperAdminUser, role: string) {
    setMessage('');
    setError('');
    try {
      await updateSuperAdminUserRole(target.id, role);
      await refreshOverview();
      setMessage(`${target.email} role changed to ${role}.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Unable to update role.');
    }
  }

  async function grantCredits(target: SuperAdminUser) {
    const parsedCredits = Number(credits);
    if (!Number.isInteger(parsedCredits) || parsedCredits < 0) {
      setError('Credits must be a non-negative whole number.');
      return;
    }

    setMessage('');
    setError('');
    try {
      await grantSuperAdminCredits(target.id, parsedCredits, note.trim() || undefined);
      await refreshOverview();
      setNote('');
      setMessage(`${target.email} now has ${parsedCredits} demo credits.`);
    } catch (creditError) {
      setError(creditError instanceof Error ? creditError.message : 'Unable to grant credits.');
    }
  }

  return (
    <div className="dash-page dash-page--admin">
      <div className="dash-page-head-group">
        <header className="pipeline-console-header">
          <div>
            <span className="dash-eyebrow">Platform control</span>
            <h2>Super Admin</h2>
          </div>
          <div className="pipeline-header-badges">
            <span className="pipeline-badge">{kpis.totalUsers} users</span>
            {kpis.pendingCredits > 0 && <span className="pipeline-badge pipeline-badge--warning">{kpis.pendingCredits} credit requests</span>}
            <button className="pipeline-icon-action" disabled={isLoading} onClick={() => void refreshOverview()} title="Refresh" type="button">
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        {message && <div className="pipeline-notice">{message}</div>}
        {error && <div className="pipeline-notice pipeline-notice--error">{error}</div>}
      </div>

      <section className="admin-kpi-strip">
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Users size={16} />
          </span>
          <div>
            <span>Total users</span>
            <strong>{kpis.totalUsers}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--success">
            <UserCheck size={16} />
          </span>
          <div>
            <span>Active users</span>
            <strong>{kpis.activeUsers}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Workflow size={16} />
          </span>
          <div>
            <span>Diagrams created</span>
            <strong>{kpis.diagrams}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon">
            <Rocket size={16} />
          </span>
          <div>
            <span>Deployments run</span>
            <strong>{kpis.deployments}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--warning">
            <BadgeDollarSign size={16} />
          </span>
          <div>
            <span>Pending credit requests</span>
            <strong>{kpis.pendingCredits}</strong>
          </div>
        </div>
        <div className="admin-kpi-card">
          <span className="admin-kpi-icon admin-kpi-icon--accent">
            <BrainCircuit size={16} />
          </span>
          <div>
            <span>AI-enabled users</span>
            <strong>{kpis.aiEnabled}</strong>
          </div>
        </div>
      </section>

      <div className="admin-console-grid">
        <section className="admin-users-panel">
          <header>
            <div className="admin-users-panel-title">
              <strong>All users and access</strong>
              <span>
                {filteredUsers.length} of {users.length} shown
              </span>
            </div>
            <div className="admin-users-filters">
              <label className="admin-search">
                <Search size={14} />
                <input onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name or email" value={searchTerm} />
              </label>
              <select onChange={(event) => setRoleFilter(event.target.value)} value={roleFilter}>
                <option value="all">All roles</option>
                {ADMIN_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="all">All status</option>
                {ADMIN_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </header>
          <div className="admin-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Workspace</th>
                  <th>Credits</th>
                  <th>Activity</th>
                  <th>Access</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((candidate) => (
                  <tr className={selectedUser?.id === candidate.id ? 'active' : ''} key={candidate.id} onClick={() => setSelectedUserId(candidate.id)}>
                    <td>
                      <strong>{candidate.name}</strong>
                      <span>{candidate.email}</span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select onChange={(event) => void changeRole(candidate, event.target.value)} value={candidate.role}>
                        {ADMIN_ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`admin-status-pill admin-status-pill--${candidate.status}`}>{candidate.status}</span>
                    </td>
                    <td>
                      <strong>{candidate.workspace?.plan ?? 'free'}</strong>
                      <span>{candidate.workspace?.name ?? 'No workspace'}</span>
                    </td>
                    <td>
                      <strong>{candidate.demoCredits} credits</strong>
                      {candidate.creditRequest?.status === 'pending' ? (
                        <span className="admin-pending-tag">{candidate.creditRequest.requestedCredits} requested</span>
                      ) : (
                        <span>{candidate.creditRequest?.status ?? 'none'}</span>
                      )}
                    </td>
                    <td>
                      <strong>{candidate.diagramsCreated} diagrams</strong>
                      <span>
                        {candidate.deploymentsCreated} deployed, {candidate.successfulDeployments} live
                      </span>
                    </td>
                    <td>
                      <strong>{candidate.accessTier}</strong>
                      <span>
                        {candidate.allowedServices} services{candidate.aiEnabled ? ', AI' : ''}
                      </span>
                    </td>
                    <td>
                      <span>{formatAdminDate(candidate.lastActivityAt ?? candidate.lastLoginAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredUsers.length && <EmptyState>No users match these filters.</EmptyState>}
          </div>
        </section>

        <aside className="admin-side-col">
          <section className="admin-detail-panel">
            {selectedUser ? (
              <>
                <header className="admin-detail-header">
                  <div>
                    <strong>{selectedUser.name}</strong>
                    <span>{selectedUser.email}</span>
                  </div>
                  <div className="admin-detail-header-pills">
                    <span className={`admin-status-pill admin-status-pill--${selectedUser.status}`}>{selectedUser.status}</span>
                    <span className="admin-role-pill">{selectedUser.role}</span>
                  </div>
                </header>

                <div className="admin-meta-grid">
                  <div>
                    <span>Workspace</span>
                    <strong>{selectedUser.workspace?.name ?? 'No workspace'}</strong>
                  </div>
                  <div>
                    <span>Plan</span>
                    <strong>{selectedUser.workspace?.plan ?? 'free'}</strong>
                  </div>
                  <div>
                    <span>Access tier</span>
                    <strong>{selectedUser.accessTier}</strong>
                  </div>
                  <div>
                    <span>Services / AI</span>
                    <strong>
                      {selectedUser.allowedServices} services{selectedUser.aiEnabled ? ', AI on' : ', AI off'}
                    </strong>
                  </div>
                  <div>
                    <span>Joined</span>
                    <strong>{formatAdminDate(selectedUser.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Last login</span>
                    <strong>{formatAdminDate(selectedUser.lastLoginAt)}</strong>
                  </div>
                  <div>
                    <span>Diagrams / deployments</span>
                    <strong>
                      {selectedUser.diagramsCreated} / {selectedUser.deploymentsCreated}
                    </strong>
                  </div>
                  <div>
                    <span>Last action</span>
                    <strong>{selectedUser.lastAction ?? 'No recent action'}</strong>
                  </div>
                </div>

                <div className={`admin-credit-card admin-credit-card--${selectedUser.creditRequest?.status ?? 'none'}`}>
                  <header>
                    <strong>Credit request</strong>
                    <span>{selectedUser.creditRequest?.status ?? 'none'}</span>
                  </header>
                  <p>{selectedUser.creditRequest?.reason || 'No request reason submitted.'}</p>
                  {selectedUser.creditRequest?.note && <p className="admin-credit-note">Admin note: {selectedUser.creditRequest.note}</p>}
                  <div className="admin-credit-dates">
                    {selectedUser.creditRequest?.requestedAt && <span>Requested {formatAdminDate(selectedUser.creditRequest.requestedAt)}</span>}
                    {selectedUser.creditRequest?.reviewedAt && <span>Reviewed {formatAdminDate(selectedUser.creditRequest.reviewedAt)}</span>}
                  </div>
                </div>

                <div className="admin-form-row">
                  <label className="pipeline-field">
                    <span>Demo credits</span>
                    <input min={0} onChange={(event) => setCredits(event.target.value)} type="number" value={credits} />
                  </label>
                  <label className="pipeline-field pipeline-field--wide">
                    <span>Admin note</span>
                    <textarea onChange={(event) => setNote(event.target.value)} placeholder="Optional note for this credit grant" rows={2} value={note} />
                  </label>
                </div>
                <button className="pipeline-primary-compact admin-grant-button" onClick={() => void grantCredits(selectedUser)} type="button">
                  Grant credits
                </button>
              </>
            ) : (
              <EmptyState>Select a user to manage role and demo credits.</EmptyState>
            )}
          </section>

          <section className="admin-activity-panel">
            <header>
              <strong>Recent activity</strong>
              <span>Audit log</span>
            </header>
            <div className="admin-activity-list">
              {overview?.recentActivities.length ? (
                overview.recentActivities.map((activity) => (
                  <div className="admin-activity-item" key={activity.id}>
                    <div>
                      <strong>{activity.actor?.email ?? 'System'}</strong>
                      <span>
                        {activity.action} on {activity.resourceType}
                      </span>
                    </div>
                    <em>{activity.createdAt ? formatAdminDate(activity.createdAt) : 'Recent'}</em>
                  </div>
                ))
              ) : (
                <EmptyState>No user activity found.</EmptyState>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatAdminDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function DeploymentTableDetails({
  deployment,
  insights,
  onViewResourceInfo,
}: {
  deployment: DeploymentRecord;
  insights?: AwsInsights;
  onViewResourceInfo: (deploymentId: string) => void;
}) {
  const nodes = deployment.diagram?.nodes ?? [];
  const services = Array.from(new Set(nodes.map((node) => node.data?.serviceName ?? node.data?.label).filter((label): label is string => Boolean(label))));
  const outputKeys = Object.keys(deployment.outputs ?? {});
  const latestLogs = deployment.logs.slice(-4);
  const resourceMetrics = buildDeploymentResourceMetrics(deployment, insights);
  const summaryRows: Array<[string, string]> = [
    ['Diagram', deployment.diagram?.name ?? deployment.name],
    ['Status', deploymentStatusLabel(deployment.status)],
    ['Region', deployment.diagram?.activeRegion ?? 'Not captured'],
    ['Resources', String(deployment.resourceCount ?? nodes.length ?? 0)],
    ['Connections', String(deployment.connectionCount ?? deployment.diagram?.edges?.length ?? 0)],
    ['Services', services.length ? services.join(', ') : 'No diagram snapshot saved for this deployment.'],
  ];
  const outputRows = Object.entries(deployment.outputs ?? {});

  return (
    <div className="dash-deploy-table-detail">
      <div className="dash-deploy-detail-actions">
        <button className="dash-secondary-action" disabled={!nodes.length} onClick={() => onViewResourceInfo(deployment._id)} type="button">
          <Eye size={14} />
          View resource info
        </button>
      </div>

      <DeploymentDetailSection meta={`${summaryRows.length} fields`} title="Diagram summary">
        <DeploymentKeyValueTable rows={summaryRows} />
      </DeploymentDetailSection>

      <DeploymentDetailSection meta={`${outputKeys.length} outputs`} title="Terraform outputs">
        {outputRows.length ? (
          <div className="dash-deploy-detail-table-wrap">
            <table className="dash-deploy-detail-table">
              <thead>
                <tr>
                  <th>Output</th>
                  <th>Type</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {outputRows.map(([key, value]) => (
                  <tr key={key}>
                    <td>
                      <strong>{key}</strong>
                    </td>
                    <td>{deploymentOutputType(value)}</td>
                    <td>
                      <code>{formatDeploymentOutputValue(value)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No resource outputs captured yet.</p>
        )}
      </DeploymentDetailSection>

      <DeploymentDetailSection className="dash-deploy-live-section" meta={`${resourceMetrics.length} resources`} title="Live usage and billing">
        {resourceMetrics.length ? (
          <div className="dash-deploy-detail-table-wrap">
            <table className="dash-deploy-detail-table dash-deploy-live-table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Service</th>
                  <th>Usage</th>
                  <th>Health</th>
                  <th>Month spend</th>
                  <th>Bill share</th>
                </tr>
              </thead>
              <tbody>
                {resourceMetrics.map((metric) => (
                  <tr key={metric.key}>
                    <td>
                      <strong>{metric.label}</strong>
                      <span>{metric.resourceId}</span>
                    </td>
                    <td>{metric.service}</td>
                    <td>{metric.usage}</td>
                    <td>
                      <em>{metric.health}</em>
                    </td>
                    <td>${metric.spend.toFixed(2)}</td>
                    <td>{metric.billShare}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Sync AWS usage and billing to show real-time resource parameters for this deployed diagram.</p>
        )}
      </DeploymentDetailSection>

      <DeploymentDetailSection meta={`${latestLogs.length} entries`} title="Recent logs">
        {latestLogs.length ? (
          <div className="dash-deploy-detail-table-wrap">
            <table className="dash-deploy-detail-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {latestLogs.map((log, index) => (
                  <tr key={`${log.at ?? index}-${log.message}`}>
                    <td>{log.at ? new Date(log.at).toLocaleString() : 'Recent'}</td>
                    <td>
                      <em className={`dash-deploy-log-pill dash-deploy-log--${deploymentLogLevel(log.level, log.message)}`}>
                        {deploymentLogLevel(log.level, log.message)}
                      </em>
                    </td>
                    <td>{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No logs recorded yet.</p>
        )}
      </DeploymentDetailSection>
    </div>
  );
}

function DeploymentDetailSection({
  children,
  className = '',
  meta,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  meta: string;
  title: string;
}) {
  return (
    <details className={`dash-deploy-detail-section ${className}`} open>
      <summary>
        <strong>{title}</strong>
        <span>{meta}</span>
      </summary>
      <div className="dash-deploy-detail-section__body">{children}</div>
    </details>
  );
}

function DeploymentKeyValueTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="dash-deploy-detail-table-wrap">
      <table className="dash-deploy-detail-table dash-deploy-detail-table--key-value">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DeploymentResourceMetric = {
  key: string;
  label: string;
  service: string;
  resourceId: string;
  usage: string;
  health: string;
  spend: number;
  billShare: number;
};

function buildDeploymentResourceMetrics(deployment: DeploymentRecord, insights?: AwsInsights): DeploymentResourceMetric[] {
  if (!insights) return [];

  const totalSpend = insights.billing.monthlySpend || insights.billing.byService.reduce((sum, item) => sum + item.cost, 0) || 0;
  const outputResources = Object.entries(deployment.outputs ?? {})
    .map(([key, output]) => normalizeDeploymentOutputResource(key, output))
    .filter((resource): resource is { key: string; label: string; service: string; resourceId: string } => Boolean(resource));
  const nodeResources = (deployment.diagram?.nodes ?? []).map((node) => ({
    key: node.id,
    label: node.data?.label ?? node.data?.serviceName ?? node.id,
    service: node.data?.serviceName ?? node.data?.label ?? node.data?.serviceId ?? 'AWS',
    resourceId: String(node.data?.config?.name ?? node.data?.config?.bucket ?? node.data?.config?.identifier ?? node.id),
  }));
  const resources = dedupeDeploymentResources([...outputResources, ...nodeResources]);

  return resources.map((resource) => {
    const inventory = findInsightInventory(resource.service, insights);
    const spend = inventory?.spend ?? findServiceSpend(resource.service, insights);
    const billShare = totalSpend > 0 ? Math.round((spend / totalSpend) * 1000) / 10 : 0;

    return {
      ...resource,
      service: canonicalAwsService(resource.service),
      usage: inventory ? `${inventory.count} active ${pluralizeResource(canonicalAwsService(resource.service), inventory.count)}` : 'Not synced',
      health: inventory?.health ?? 'No live data',
      spend,
      billShare,
    };
  });
}

function normalizeDeploymentOutputResource(key: string, output: unknown) {
  if (!output || typeof output !== 'object') return undefined;
  const value = output as Record<string, unknown>;
  const service = String(value.service ?? key).trim();
  const resourceId = String(value.id ?? value.arn ?? value.domain_name ?? value.website_endpoint ?? value.name ?? key).trim();

  return {
    key,
    label: String(value.label ?? key).trim(),
    service,
    resourceId,
  };
}

function dedupeDeploymentResources(resources: Array<{ key: string; label: string; service: string; resourceId: string }>) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${canonicalAwsService(resource.service)}:${resource.resourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findInsightInventory(service: string, insights: AwsInsights) {
  const target = canonicalAwsService(service);
  return insights.inventory.find((item) => canonicalAwsService(item.service) === target);
}

function findServiceSpend(service: string, insights: AwsInsights) {
  const target = canonicalAwsService(service);
  return insights.billing.byService.find((item) => canonicalAwsService(item.service) === target)?.cost ?? 0;
}

function canonicalAwsService(service: string) {
  const value = String(service || '').toLowerCase();
  if (value.includes('cloudfront')) return 'CloudFront';
  if (value.includes('cloudwatch')) return 'CloudWatch';
  if (value.includes('lambda')) return 'Lambda';
  if (value.includes('elastic compute') || value.includes('ec2') || value.includes('ebs')) return 'EC2';
  if (value.includes('simple storage') || value.includes('s3')) return 'S3';
  if (value.includes('relational database') || value.includes('rds')) return 'RDS';
  if (value.includes('dynamodb')) return 'DynamoDB';
  if (value.includes('simple queue') || value.includes('sqs')) return 'SQS';
  if (value.includes('notification') || value.includes('sns')) return 'SNS';
  if (value.includes('eventbridge') || value.includes('events')) return 'EventBridge';
  if (value.includes('api gateway') || value.includes('apigw')) return 'API Gateway';
  if (value.includes('ecs')) return 'ECS';
  if (value.includes('eks')) return 'EKS';
  if (value.includes('iam')) return 'IAM';
  if (value.includes('waf')) return 'WAF';
  if (value.includes('kms')) return 'KMS';
  return service || 'AWS';
}

function pluralizeResource(service: string, count: number) {
  const singular = {
    S3: 'bucket',
    EC2: 'instance',
    Lambda: 'function',
    RDS: 'database',
    DynamoDB: 'table',
    SQS: 'queue',
    SNS: 'topic',
    EventBridge: 'rule',
    CloudWatch: 'signal',
    ECS: 'cluster',
    EKS: 'cluster',
    IAM: 'identity',
  }[service] ?? 'resource';
  return count === 1 ? singular : `${singular}s`;
}

function deploymentOutputType(value: unknown) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function formatDeploymentOutputValue(value: unknown) {
  if (value === null || value === undefined) return 'Not returned';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deploymentStatusGroup(status: DeploymentRecord['status']): 'successful' | 'pending' | 'error' {
  if (['deployed', 'destroyed'].includes(status)) return 'successful';
  if (['failed', 'cancelled'].includes(status)) return 'error';
  return 'pending';
}

function deploymentFilterLabel(filter: 'all' | 'successful' | 'pending' | 'error') {
  if (filter === 'all') return 'All deployments';
  if (filter === 'successful') return 'Successful';
  if (filter === 'pending') return 'Pending';
  return 'Error';
}

function deploymentStatusLabel(status: DeploymentRecord['status']) {
  return status.replace(/_/g, ' ');
}

function formatDeploymentDate(deployment: DeploymentRecord) {
  const value = deployment.finishedAt ?? deployment.startedAt ?? deployment.createdAt;
  return value ? new Date(value).toLocaleString() : 'Not started';
}

function canDestroyDeployment(status: DeploymentRecord['status']) {
  return status === 'deployed' || status === 'failed';
}

const FORCE_DESTROY_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying', 'destroying'];
const STUCK_DEPLOYMENT_THRESHOLD_MS = 5 * 60 * 1000;

function deploymentElapsedMs(deployment: DeploymentRecord) {
  const startedAt = deployment.startedAt ?? deployment.createdAt;
  if (!startedAt) return 0;
  return Math.max(0, Date.now() - new Date(startedAt).getTime());
}

function formatElapsedDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function isDeploymentStuck(deployment: DeploymentRecord) {
  return FORCE_DESTROY_STATUSES.includes(deployment.status) && deploymentElapsedMs(deployment) >= STUCK_DEPLOYMENT_THRESHOLD_MS;
}

function deploymentLogLevel(level: string, message: string): 'error' | 'warning' | 'info' {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return message.toLowerCase().includes('error') ? 'error' : 'info';
}

function SecurityPage({ insights }: { insights?: AwsInsights }) {
  const findings = insights?.securityFindings ?? securityFindings;
  return (
    <div className="dash-page">
      <Panel title="Findings" action="Export report">
        <div className="dash-finding-list">
          {findings.length ? (
            findings.map((finding) => (
              <div className={`dash-finding dash-finding--${finding.severity.toLowerCase()}`} key={finding.title}>
                <strong>{finding.severity}</strong>
                <div>
                  <h3>{finding.title}</h3>
                  <span>{finding.resource}</span>
                  <p>{getFindingFix(finding)}</p>
                </div>
                <button>Fix with AI</button>
              </div>
            ))
          ) : (
            <EmptyState>No security findings yet. Connect AWS to run live checks.</EmptyState>
          )}
        </div>
      </Panel>
    </div>
  );
}

function getCostRecommendationCards(insights?: AwsInsights) {
  return (
    insights?.recommendations.map((item) => ({
      title: item.title,
      savings: `$${item.savings}/mo`,
      effort: item.effort,
      icon: Server,
    })) ?? costRecommendations
  );
}

function CostRecommendationGrid({ insights }: { insights?: AwsInsights }) {
  const recommendations = getCostRecommendationCards(insights);

  if (!recommendations.length) {
    return insights ? <EmptyState>No Cost Explorer recommendations generated yet.</EmptyState> : null;
  }

  return (
    <div className="dash-cost-grid">
      {recommendations.map((item) => {
        const Icon = item.icon;
        return (
          <div className="dash-cost-card" key={item.title}>
            <Icon size={20} />
            <h3>{item.title}</h3>
            <strong>{item.savings}</strong>
            <span>Effort: {item.effort}</span>
            <button>Apply recommendation</button>
          </div>
        );
      })}
    </div>
  );
}

function RuntimeLabPage() {
  const [snapshot, setSnapshot] = useState<NodeRuntimeSnapshot | null>(null);
  const [selectedMode, setSelectedMode] = useState<NodeLabMode>('worker-thread');
  const [intensity, setIntensity] = useState<NodeLabIntensity>('standard');
  const [run, setRun] = useState<NodeConceptRun | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [detail, setDetail] = useState<RuntimeLabDetail | null>(null);
  const memoryUsagePercent = snapshot
    ? Math.round(((snapshot.memory.systemTotalMb - snapshot.memory.systemFreeMb) / snapshot.memory.systemTotalMb) * 100)
    : 0;
  const heapPercent = snapshot ? Math.round((snapshot.memory.heapUsedMb / Math.max(snapshot.memory.heapTotalMb, 1)) * 100) : 0;

  async function refreshSnapshot() {
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      setSnapshot(await getNodeRuntimeSnapshot());
      setMessage('Runtime snapshot refreshed.');
    } catch (snapshotError) {
      setError(snapshotError instanceof Error ? snapshotError.message : 'Unable to load Node runtime snapshot.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRunDemo() {
    setError('');
    setMessage('');
    setIsLoading(true);

    try {
      const result = await runNodeConceptDemo(selectedMode, intensity);
      const nextSnapshot = await getNodeRuntimeSnapshot();
      setRun(result);
      setSnapshot(nextSnapshot);
      setMessage(`${formatConceptLabel(result.concept)} completed in ${result.wallClockMs} ms.`);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Unable to run Node runtime demo.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  return (
    <div className="dash-page runtime-lab-page">
      <section className="dash-page-intro runtime-lab-intro">
        <div>
          <span className="dash-eyebrow">Advanced Node.js learning lab</span>
          <h2>Visualize processes, worker threads, CPU cores, and cluster workers.</h2>
          <p>
            Run bounded backend demos from the authenticated dashboard and watch which work stays in the API process,
            which work moves to another PID, and how worker results return to React.
          </p>
        </div>
        <div className="runtime-lab-actions">
          <button className="dash-secondary-action" disabled={isLoading} onClick={() => void refreshSnapshot()}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="dash-primary-action" disabled={isLoading} onClick={() => void handleRunDemo()}>
            <Play size={16} />
            {isLoading ? 'Running...' : 'Run selected demo'}
          </button>
        </div>
      </section>

      {error && <div className="dash-global-error">{error}</div>}
      {message && <div className="dash-global-success">{message}</div>}

      <section className="runtime-lab-kpis">
        <button className="dash-kpi-card dash-tone-cyan runtime-lab-click-card" onClick={() => setDetail(getRuntimeMetricDetail('pid', snapshot))} type="button">
          <Server size={20} />
          <strong>{snapshot?.process.pid ?? '...'}</strong>
          <span>API process PID</span>
          <em>{snapshot ? `${snapshot.process.nodeVersion} - ${snapshot.process.platform}` : 'Loading runtime'}</em>
        </button>
        <button className="dash-kpi-card dash-tone-violet runtime-lab-click-card" onClick={() => setDetail(getRuntimeMetricDetail('cpu', snapshot))} type="button">
          <Cpu size={20} />
          <strong>{snapshot ? `${snapshot.cpu.availableCores}/${snapshot.cpu.logicalCores}` : '...'}</strong>
          <span>Available CPU cores</span>
          <em>Cluster workers are capped for safe demos</em>
        </button>
        <button className="dash-kpi-card dash-tone-emerald runtime-lab-click-card" onClick={() => setDetail(getRuntimeMetricDetail('memory', snapshot))} type="button">
          <Activity size={20} />
          <strong>{snapshot ? `${memoryUsagePercent}%` : '...'}</strong>
          <span>System memory used</span>
          <em>{snapshot ? `${snapshot.memory.rssMb} MB RSS` : 'Loading memory'}</em>
        </button>
        <button className="dash-kpi-card dash-tone-amber runtime-lab-click-card" onClick={() => setDetail(getRuntimeMetricDetail('heap', snapshot))} type="button">
          <TerminalSquare size={20} />
          <strong>{snapshot ? `${heapPercent}%` : '...'}</strong>
          <span>Node heap used</span>
          <em>{snapshot ? `${snapshot.memory.heapUsedMb}/${snapshot.memory.heapTotalMb} MB` : 'Loading heap'}</em>
        </button>
      </section>

      <div className="dash-two-col dash-two-col--wide runtime-lab-grid">
        <Panel title="Runtime controls" action={snapshot ? `Uptime ${snapshot.process.uptimeSeconds}s` : 'Loading'}>
          <div className="runtime-lab-controls">
            <div className="runtime-lab-mode-grid">
              {NODE_LAB_MODES.map((item) => (
                <button
                  className={selectedMode === item.mode ? 'active' : ''}
                  key={item.mode}
                  onClick={() => {
                    setSelectedMode(item.mode);
                    setDetail(getRuntimeModeDetail(item.mode));
                  }}
                  type="button"
                >
                  {item.mode === 'worker-thread' && <Cpu size={18} />}
                  {item.mode === 'child-process' && <TerminalSquare size={18} />}
                  {item.mode === 'cluster' && <Network size={18} />}
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>

            <label className="runtime-lab-load">
              Load intensity
              <select value={intensity} onChange={(event) => setIntensity(event.target.value as NodeLabIntensity)}>
                <option value="light">Light</option>
                <option value="standard">Standard</option>
                <option value="heavy">Heavy</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel title="CPU core view" action={snapshot ? `${snapshot.cpu.cores.length} shown` : 'Loading'}>
          <div className="runtime-lab-core-grid">
            {(snapshot?.cpu.cores.slice(0, 12) ?? []).map((core) => (
              <button className="runtime-lab-core runtime-lab-click-card" key={core.id} onClick={() => setDetail(getRuntimeCoreDetail(core))} type="button">
                <div>
                  <strong>Core {core.id}</strong>
                  <span>{core.speedMhz} MHz</span>
                </div>
                <i>
                  <b style={{ width: `${Math.max(core.activityScore, 8)}%` }} />
                </i>
                <em>{core.activityScore}% activity score</em>
              </button>
            ))}
            {!snapshot && <EmptyState>Runtime snapshot is loading.</EmptyState>}
          </div>
        </Panel>
      </div>

      <Panel title="Latest demo result" action={run ? formatConceptLabel(run.concept) : 'Run a demo'}>
        {run ? (
          <div className="runtime-lab-result-layout">
            <button className="runtime-lab-result-summary runtime-lab-click-card" onClick={() => setDetail(getRuntimeRunDetail(run))} type="button">
              <span>{run.intensity} load</span>
              <strong>{run.wallClockMs} ms wall time</strong>
              <p>{run.summary}</p>
              <div>
                <small>Primary PID</small>
                <b>{run.primaryPid}</b>
              </div>
              <div>
                <small>Load average</small>
                <b>{run.cpu.loadAverage.join(' / ')}</b>
              </div>
            </button>
            <div className="runtime-lab-unit-grid">
              {run.units.map((unit, index) => (
                <button
                  className="runtime-lab-unit-card runtime-lab-click-card"
                  key={`${unit.role}-${unit.pid}-${unit.workerId ?? unit.threadId ?? index}`}
                  onClick={() => setDetail(getRuntimeUnitDetail(unit, run))}
                  type="button"
                >
                  <span>{unit.role}</span>
                  <strong>PID {unit.pid}</strong>
                  <p>
                    {unit.workerId ? `Worker ${unit.workerId}` : unit.threadId ? `Thread ${unit.threadId}` : 'Process task'} - {unit.durationMs} ms
                  </p>
                  <em>{unit.primes} primes from limit {unit.limit}</em>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState>Select a Node.js concept and run the demo to visualize thread, process, and cluster behavior.</EmptyState>
        )}
      </Panel>
      {detail && <RuntimeLabDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function RuntimeLabDetailModal({ detail, onClose }: { detail: RuntimeLabDetail; onClose: () => void }) {
  return (
    <div className="runtime-lab-detail-backdrop" role="presentation" onClick={onClose}>
      <section className="runtime-lab-detail-modal" role="dialog" aria-modal="true" aria-labelledby="runtime-lab-detail-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{detail.subtitle}</span>
            <h3 id="runtime-lab-detail-title">{detail.title}</h3>
          </div>
          <button aria-label="Close runtime explanation" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="runtime-lab-detail-body">
          <section>
            <h4>Process</h4>
            <p>{detail.process}</p>
          </section>
          <section>
            <h4>Real application example</h4>
            <p>{detail.realTimeExample}</p>
          </section>
          <section>
            <h4>Execution steps</h4>
            <ol>
              {detail.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          {detail.codePath && (
            <section>
              <h4>Code path</h4>
              <code>{detail.codePath}</code>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function getRuntimeMetricDetail(kind: 'pid' | 'cpu' | 'memory' | 'heap', snapshot: NodeRuntimeSnapshot | null): RuntimeLabDetail {
  const metricDetails: Record<typeof kind, RuntimeLabDetail> = {
    pid: {
      title: `API process PID ${snapshot?.process.pid ?? 'loading'}`,
      subtitle: 'Main Node.js process',
      process:
        'The PID identifies the Express API process serving authenticated dashboard requests. Worker threads share this PID, while child process and cluster demos create separate PIDs. This is the quickest way to see whether work stayed inside the API process or moved outside it.',
      realTimeExample:
        'In this IAAS app, login, diagram saving, AWS account listing, and dashboard reads should stay in the API process. Terraform apply, long AWS sync, and heavy graph scoring should move to separate workers so the API stays responsive for other users.',
      steps: [
        'React calls GET /api/v1/node-lab/snapshot after the dashboard page opens.',
        'Express reads process.pid, process uptime, Node version, and platform.',
        'The dashboard renders the PID so you can compare it with worker result PIDs.',
      ],
      codePath: 'src/dashboard/nodeLabApi.ts -> IAAS backend/src/routes/nodeLabRoutes.js -> src/utils/nodeRuntimeLab.js',
    },
    cpu: {
      title: `${snapshot?.cpu.availableCores ?? 'Available'} CPU cores`,
      subtitle: 'Parallelism capacity',
      process:
        'CPU cores represent how much parallel work the host can reasonably run. The demo caps workers to avoid exhausting your machine, but the concept is the same in production: CPU-heavy work must be sized and isolated.',
      realTimeExample:
        'When many users validate diagrams or run Terraform plans, workers can be scaled based on queue depth and CPU. On AWS, ECS worker tasks can scale horizontally while the API remains focused on request/response traffic.',
      steps: [
        'The backend reads os.availableParallelism() and os.cpus().',
        'Cluster mode forks a safe number of workers based on available cores.',
        'The UI displays cores so users understand why parallel jobs need limits.',
      ],
      codePath: 'IAAS backend/src/utils/nodeRuntimeLab.js',
    },
    memory: {
      title: `${snapshot ? `${snapshot.memory.rssMb} MB RSS` : 'System memory'}`,
      subtitle: 'Process and system memory pressure',
      process:
        'RSS is the resident memory used by the Node process. System memory used shows overall machine pressure. Rising memory across many requests can indicate large payloads, leaked references, or too much work running inside the API process.',
      realTimeExample:
        'Large Terraform exports, deployment logs, imported diagrams, and AWS sync summaries should not grow forever inside memory. For a production IAAS platform, large artifacts should move to S3 and workers should stream logs.',
      steps: [
        'The backend reads process.memoryUsage() and os.freemem()/os.totalmem().',
        'The dashboard calculates a system memory percentage.',
        'Users compare memory before and after running runtime demos.',
      ],
      codePath: 'IAAS backend/src/utils/nodeRuntimeLab.js',
    },
    heap: {
      title: `${snapshot ? `${snapshot.memory.heapUsedMb}/${snapshot.memory.heapTotalMb} MB heap` : 'Node heap'}`,
      subtitle: 'JavaScript object memory',
      process:
        'The Node heap stores JavaScript objects. If graph validation, Terraform parsing, or AI context building creates many objects, heap usage rises. CPU workers and job queues keep these spikes away from ordinary API requests.',
      realTimeExample:
        'A user importing a large Terraform module can create thousands of parsed resources. In a scalable version of this app, that import can run in a worker and persist a normalized result instead of blocking the dashboard API.',
      steps: [
        'The runtime snapshot reads heapUsed and heapTotal from process.memoryUsage().',
        'The UI converts these numbers into a heap percentage.',
        'The number helps explain why CPU and memory-heavy work should be isolated.',
      ],
      codePath: 'IAAS backend/src/utils/nodeRuntimeLab.js',
    },
  };

  return metricDetails[kind];
}

function getRuntimeModeDetail(mode: NodeLabMode): RuntimeLabDetail {
  const details: Record<NodeLabMode, RuntimeLabDetail> = {
    'worker-thread': {
      title: 'Worker thread',
      subtitle: 'CPU-heavy JavaScript inside the same process',
      process:
        'A worker thread runs JavaScript on a separate thread while sharing the same Node.js process PID. It is useful for CPU-bound JavaScript such as parsing, graph scoring, encryption, compression, or policy checks. It avoids blocking the event loop but does not isolate memory like a separate process.',
      realTimeExample:
        'Use this for infraflow diagram validation: a large architecture graph can be scored for missing IAM boundaries, public networking, and dependency cycles without freezing normal dashboard requests.',
      steps: [
        'The dashboard sends POST /api/v1/node-lab/run with mode worker-thread.',
        'The runtime service spawns nodeConceptLabRunner.js.',
        'The runner creates a Worker from node:worker_threads.',
        'The worker counts primes and sends a result message back to the parent process.',
      ],
      codePath: 'IAAS backend/src/tools/nodeConceptLabRunner.js -> runWorkerThreadDemo()',
    },
    'child-process': {
      title: 'Child process',
      subtitle: 'Separate PID and isolated memory',
      process:
        'A child process is a separate operating-system process. It has its own PID, stdout, stderr, and memory space. This is the right boundary for external commands, risky work, or tools with independent lifecycle requirements.',
      realTimeExample:
        'Use this for Terraform commands. Terraform init, plan, and apply should run outside the API process so CLI failures, logs, and environment variables are isolated and easier to monitor.',
      steps: [
        'The dashboard sends mode child-process.',
        'The runtime service starts a Node process using process.execPath.',
        'The child performs bounded CPU work and writes JSON to stdout.',
        'The parent parses stdout and returns the structured result to React.',
      ],
      codePath: 'IAAS backend/src/utils/nodeRuntimeLab.js -> runNodeConceptDemo()',
    },
    cluster: {
      title: 'Cluster workers',
      subtitle: 'Multiple Node worker processes',
      process:
        'The cluster module forks multiple Node processes from a primary process. Each worker gets its own PID. It demonstrates process-level parallelism and helps explain how CPU work can be split across cores.',
      realTimeExample:
        'Use this pattern conceptually for parallel validation shards: one worker checks IAM risk, another checks networking, another checks cost signals, and another checks Terraform compatibility. In production, ECS tasks plus SQS are usually a better operational model than in-process cluster for background jobs.',
      steps: [
        'The dashboard sends mode cluster.',
        'The runner calculates a safe worker count.',
        'The primary process forks workers and sends each a prime-count task.',
        'Each worker returns PID, worker ID, duration, and result size.',
      ],
      codePath: 'IAAS backend/src/tools/nodeConceptLabRunner.js -> runClusterDemo()',
    },
  };

  return details[mode];
}

function getRuntimeCoreDetail(core: NodeRuntimeSnapshot['cpu']['cores'][number]): RuntimeLabDetail {
  return {
    title: `CPU Core ${core.id}`,
    subtitle: `${core.speedMhz} MHz logical core`,
    process:
      'This core card visualizes one logical CPU core exposed by the host. The activity score is derived from OS CPU time counters and is a teaching signal rather than a live profiler. It helps explain that parallel work competes for finite CPU capacity.',
    realTimeExample:
      'If hundreds of users trigger architecture validation at the same time, CPU cores become the bottleneck. A production AWS setup should scale worker tasks and use SQS queue depth, CPU, and latency metrics to decide when to add capacity.',
    steps: [
      'Node reads os.cpus() and maps each core to model, speed, and CPU time counters.',
      'The backend computes activity from non-idle CPU time.',
      'The dashboard renders the activity bar and lets you inspect what the core represents.',
    ],
    codePath: 'IAAS backend/src/utils/nodeRuntimeLab.js -> getNodeRuntimeSnapshot()',
  };
}

function getRuntimeRunDetail(run: NodeConceptRun): RuntimeLabDetail {
  return {
    title: `${formatConceptLabel(run.concept)} run`,
    subtitle: `${run.intensity} load completed in ${run.wallClockMs} ms`,
    process:
      'This summary shows the full request-to-worker round trip: React sends the selected mode, Express validates it, the runtime service starts the isolated runner, the runner performs CPU work, and JSON comes back to the dashboard.',
    realTimeExample:
      'This is the same shape a deployment workflow should use: the dashboard asks for work, the backend validates and starts a safe execution boundary, and the UI displays status and logs without blocking other users.',
    steps: [
      'React calls runNodeConceptDemo(mode, intensity).',
      'Express validates mode and intensity with zod.',
      'The runtime service starts nodeConceptLabRunner.js with a timeout.',
      'The runner returns worker/process result units for visualization.',
    ],
    codePath: 'src/dashboard/nodeLabApi.ts -> IAAS backend/src/routes/nodeLabRoutes.js -> src/utils/nodeRuntimeLab.js',
  };
}

function getRuntimeUnitDetail(unit: NodeConceptRun['units'][number], run: NodeConceptRun): RuntimeLabDetail {
  const identity = unit.workerId ? `cluster worker ${unit.workerId}` : unit.threadId ? `worker thread ${unit.threadId}` : unit.role;

  return {
    title: `${identity} result`,
    subtitle: `PID ${unit.pid} - ${unit.durationMs} ms`,
    process:
      'A result unit is one execution participant returned by the backend runner. In worker-thread mode it represents a thread in the same PID. In child-process and cluster-style process work it represents a separate process boundary.',
    realTimeExample:
      'For a real deployment pipeline, each unit could represent one Terraform plan job, one AWS region sync, or one architecture validation shard. The dashboard would show status, logs, duration, and errors for each unit.',
    steps: [
      `The selected ${formatConceptLabel(run.concept)} demo created this unit.`,
      `It processed a bounded prime-count task with limit ${unit.limit}.`,
      `It found ${unit.primes} primes and returned in ${unit.durationMs} ms.`,
      'The parent process serialized this result as JSON for the React dashboard.',
    ],
    codePath: 'IAAS backend/src/tools/nodeConceptLabRunner.js',
  };
}

function formatConceptLabel(concept: string) {
  return concept.replace(/_/g, ' ');
}

function getFindingFix(finding: unknown) {
  if (finding && typeof finding === 'object' && 'fix' in finding) {
    const fix = (finding as { fix?: unknown }).fix;
    if (typeof fix === 'string' && fix.trim()) {
      return fix;
    }
  }

  return 'Review this AWS finding in the source service console.';
}

function ConnectAwsPage({ accounts, regions, onAwsChanged }: { accounts: AwsAccountRecord[]; regions: string[]; onAwsChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [defaultRegion, setDefaultRegion] = useState(regions[0] ?? 'ap-south-1');
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deployerArn, setDeployerArn] = useState('');
  const [deployerIdentityError, setDeployerIdentityError] = useState('');
  const [copiedField, setCopiedField] = useState('');

  useEffect(() => {
    if (!regions.includes(defaultRegion) && regions[0]) setDefaultRegion(regions[0]);
  }, [defaultRegion, regions]);

  useEffect(() => {
    getDeployerIdentity()
      .then((identity) => setDeployerArn(identity.arn))
      .catch((identityError) => setDeployerIdentityError(identityError instanceof Error ? identityError.message : 'Unable to resolve infraflow AWS identity'));
  }, []);

  function copyToClipboard(field: string, value: string) {
    void navigator.clipboard?.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? '' : current)), 1800);
  }

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsConnecting(true);

    try {
      await connectAwsAccount({
        name,
        accountId,
        roleArn,
        externalId: externalId || undefined,
        defaultRegion,
      });
      setMessage('AWS account connected and synced successfully.');
      setName('');
      setAccountId('');
      setRoleArn('');
      setExternalId('');
      await onAwsChanged();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'AWS connection failed');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSync(id: string) {
    setError('');
    setMessage('');
    setIsConnecting(true);
    try {
      await syncAwsAccount(id);
      setMessage('AWS account synced successfully.');
      await onAwsChanged();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'AWS sync failed');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect(account: AwsAccountRecord) {
    const confirmed = window.confirm(`Disconnect ${account.name} from infraflow? Live AWS insights and sync will stop for this account.`);
    if (!confirmed) return;

    setError('');
    setMessage('');
    setIsConnecting(true);

    try {
      await disconnectAwsAccount(account._id);
      setMessage(`${account.name} disconnected successfully.`);
      await onAwsChanged();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'AWS disconnect failed');
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="dash-page">
      <Panel title="One-time IAM role setup" action="Recommended">
        <p className="dash-role-setup-intro">
          Create a dedicated IAM role in AWS with the trust and permissions policies below, attached once. This covers every resource type
          infraflow can deploy (S3, VPC/EC2, Lambda, ECS, RDS/DocumentDB, API Gateway, and more) plus the IAM role management infraflow needs
          for features like Lambda execution roles and GitHub Actions OIDC — so you won't hit missing-permission errors piecemeal, one
          deployment at a time. Paste the resulting role ARN into "Connect AWS account" below. You can connect as many roles/accounts as you
          want and pick which one to deploy with from the dropdown shown when you deploy a diagram.
        </p>
        {deployerIdentityError && <div className="dash-form-error">{deployerIdentityError}</div>}
        <div className="dash-role-setup-grid">
          <div className="dash-role-setup-block">
            <header>
              <strong>1. Trust policy</strong>
              <button
                className="pipeline-link-button"
                disabled={!deployerArn}
                onClick={() => copyToClipboard('trust', JSON.stringify(buildDeployRoleTrustPolicy(deployerArn, externalId || undefined), null, 2))}
                type="button"
              >
                <Copy size={14} />
                {copiedField === 'trust' ? 'Copied' : 'Copy'}
              </button>
            </header>
            <p>Who is allowed to assume this role — infraflow's own AWS identity, resolved live below.</p>
            <pre>{deployerArn ? JSON.stringify(buildDeployRoleTrustPolicy(deployerArn, externalId || undefined), null, 2) : 'Resolving infraflow AWS identity...'}</pre>
          </div>
          <div className="dash-role-setup-block">
            <header>
              <strong>2. Permissions policy</strong>
              <button
                className="pipeline-link-button"
                onClick={() => copyToClipboard('permissions', JSON.stringify(deployRolePermissionsPolicy, null, 2))}
                type="button"
              >
                <Copy size={14} />
                {copiedField === 'permissions' ? 'Copied' : 'Copy'}
              </button>
            </header>
            <p>What the role can actually do. IAM management is scoped to role/infraflow-* only — never your own existing roles.</p>
            <pre>{JSON.stringify(deployRolePermissionsPolicy, null, 2)}</pre>
          </div>
        </div>
      </Panel>
      <div className="dash-connect-layout">
        <Panel title="Connection steps" action="IAM setup">
          <div className="dash-connect-steps">
            {awsConnectionSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title}>
                  <span>{index + 1}</span>
                  <Icon size={19} />
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Connect AWS account" action="AssumeRole">
          <form className="dash-role-form" onSubmit={handleConnect}>
            <label>
              Account name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production AWS" required />
            </label>
            <label>
              AWS Account ID
              <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="123456789012" required />
            </label>
            <label>
              IAM Role ARN
              <input value={roleArn} onChange={(event) => setRoleArn(event.target.value)} placeholder="arn:aws:iam::123456789012:role/infraflowRole" required />
            </label>
            <label>
              External ID
              <input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Optional but recommended" />
            </label>
            <label>
              Default region
              <select value={defaultRegion} onChange={(event) => setDefaultRegion(event.target.value)}>
                {regions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>
            {message && <div className="dash-form-success">{message}</div>}
            {error && <div className="dash-form-error">{error}</div>}
            <button className="dash-primary-action" disabled={isConnecting}>
              <ExternalLink size={16} />
              {isConnecting ? 'Connecting...' : 'Connect and sync'}
            </button>
          </form>
        </Panel>
      </div>
      <Panel title="Connected accounts" action={`${accounts.length} accounts`}>
        <div className="dash-account-list">
          {accounts.length ? (
            accounts.map((account) => (
              <div className="dash-account-row" key={account._id}>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.accountId || 'Unknown account'} - {account.defaultRegion}</span>
                  {account.lastError && <small>{account.lastError}</small>}
                </div>
                <em>{account.status}</em>
                <div className="dash-account-actions">
                  <button className="dash-secondary-action" disabled={isConnecting} onClick={() => void handleSync(account._id)}>
                    <RefreshCw size={15} />
                    Sync now
                  </button>
                  <button className="dash-secondary-action dash-danger-action" disabled={isConnecting} onClick={() => void handleDisconnect(account)}>
                    <Trash2 size={15} />
                    Disconnect
                  </button>
                </div>
              </div>
            ))
          ) : (
            <EmptyState>No AWS account connected yet.</EmptyState>
          )}
        </div>
      </Panel>
    </div>
  );
}

function hasGithubWorkflowScope(connection: GithubConnection) {
  if (!connection.scopes?.length) return true;
  return connection.scopes.includes('workflow');
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="dash-empty-state">{children}</div>;
}

function KpiGrid({ insights }: { insights?: AwsInsights }) {
  const [detail, setDetail] = useState<RuntimeLabDetail | null>(null);
  const activeResourceCount = insights?.inventory.reduce((sum, resource) => sum + Number(resource.count ?? 0), 0) ?? 0;
  const kpis = insights
    ? [
        { label: 'Monthly spend', value: `$${insights.billing.monthlySpend.toFixed(2)}`, change: insights.syncedAt ? 'Live sync' : 'No live sync', icon: BadgeDollarSign, tone: 'cyan' },
        {
          label: 'Active resources',
          value: String(activeResourceCount),
          change: 'Synced inventory',
          icon: Server,
          tone: 'violet',
        },
        { label: 'Estimated savings', value: `$${insights.billing.estimatedSavings}/mo`, change: `${insights.recommendations.length} actions`, icon: CheckCircle2, tone: 'emerald' },
        { label: 'Security warnings', value: String(insights.resources.securityWarnings ?? 0), change: `${insights.securityFindings.length} findings`, icon: AlertTriangle, tone: 'amber' },
      ]
    : dashboardKpis;

  return (
    <>
      <section className="dash-kpi-grid">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button className={`dash-kpi-card dash-tone-${kpi.tone} runtime-lab-click-card`} key={kpi.label} onClick={() => setDetail(getDashboardKpiDetail(kpi))} type="button">
              <Icon size={20} />
              <strong>{kpi.value}</strong>
              <span>{kpi.label}</span>
              <em>{kpi.change}</em>
            </button>
          );
        })}
      </section>
      {detail && <RuntimeLabDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function ResourceTable({ insights }: { insights?: AwsInsights }) {
  const [detail, setDetail] = useState<RuntimeLabDetail | null>(null);
  const inventory = insights
    ? insights.inventory.map((resource) => ({
        service: resource.service,
        count: resource.count,
        health: resource.health,
        spend: `$${resource.spend.toFixed(2)}`,
        icon: resourceInventory.find((item) => item.service === resource.service)?.icon ?? CloudCog,
      }))
    : resourceInventory;

  return (
    <>
      <div className="dash-resource-table">
        {inventory.map((resource) => {
          const Icon = resource.icon;
          return (
            <button key={resource.service} onClick={() => setDetail(getResourceCardDetail(resource))} type="button">
              <Icon size={17} />
              <strong>{resource.service}</strong>
              <span>{resource.count} active</span>
              <span>{resource.health}</span>
              <em>{resource.spend}</em>
            </button>
          );
        })}
      </div>
      {detail && <RuntimeLabDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function getDashboardKpiDetail(kpi: { label: string; value: string; change: string }): RuntimeLabDetail {
  const examples: Record<string, string> = {
    'Monthly spend':
      'A platform owner connects AWS and immediately sees whether current month spend is stable. If the value rises after a deployment, they can inspect the Overview cost section to see which service caused the increase.',
    'Active resources':
      'A DevOps user imports or syncs AWS resources and checks whether the dashboard inventory matches the expected diagram. A sudden count increase can indicate drift or manually created resources.',
    'Estimated savings':
      'A team can use this value before a sprint planning meeting to decide whether idle EC2, old snapshots, over-provisioned RDS, or unused load balancers should be cleaned up first.',
    'Security warnings':
      'A security reviewer can use this value as the first signal before opening the Security Review page to inspect public exposure, broad IAM permissions, missing encryption, or risky networking.',
  };

  return {
    title: kpi.label,
    subtitle: `Dashboard metric: ${kpi.value}`,
    process:
      'A KPI card compresses a larger backend process into one readable number. React renders the card, the Node API provides either demo values or live AWS insight values, and MongoDB stores connected account and diagram context that makes the metric useful.',
    realTimeExample:
      examples[kpi.label] ??
      'A user scans this card to understand current platform state, then opens the related dashboard page for deeper AWS, Terraform, deployment, or security action.',
    steps: [
      'The dashboard asks the backend for AWS insights and saved application state.',
      'The backend normalizes AWS billing, inventory, security, and recommendation data.',
      'React maps the normalized value into a compact KPI card.',
      'This popup explains what the number means and how a real operator should use it.',
    ],
    codePath: 'src/dashboard/DashboardShell.tsx -> IAAS backend AWS insight routes -> MongoDB account/diagram data',
  };
}

function getResourceCardDetail(resource: { service: string; count: number; health: string; spend: string }): RuntimeLabDetail {
  return {
    title: `${resource.service} resources`,
    subtitle: `${resource.count} active - ${resource.spend}`,
    process:
      'A resource card represents one AWS service after inventory sync. The backend should call AWS APIs, normalize counts and health signals, attach spend when available, and return a stable shape that React can render without knowing each AWS API format.',
    realTimeExample: `Real example: if ${resource.service} shows unexpected active resources or spend, a DevOps user can compare the live AWS inventory with the visual diagram and generated Terraform to identify drift, unused resources, or missing ownership.`,
    steps: [
      'The user connects AWS with an IAM role and starts sync from the dashboard.',
      'The Node backend reads service inventory and billing metadata through AWS APIs.',
      'MongoDB can persist account connection metadata and diagram mappings.',
      'React renders one service card for quick scanning and opens this popup for the operational explanation.',
    ],
    codePath: 'src/dashboard/DashboardShell.tsx -> ResourceTable() -> IAAS backend AWS sync utilities',
  };
}

function PermissionErrorList({ insights, services }: { insights: AwsInsights; services?: string[] }) {
  const errors = services?.length
    ? insights.permissionErrors?.filter((error) => services.includes(error.service)) ?? []
    : insights.permissionErrors ?? [];

  if (!errors.length) return null;

  return (
    <div className="dash-permission-errors">
      {errors.map((error) => (
        <div key={`${error.service}-${error.code ?? error.message}`}>
          <AlertTriangle size={16} />
          <strong>{error.service}</strong>
          <span>{error.message}</span>
        </div>
      ))}
    </div>
  );
}

function BillingServiceTable({ insights }: { insights: AwsInsights }) {
  const total = insights.billing.monthlySpend || 0;

  if (!insights.billing.byService.length) {
    return <EmptyState>No Cost Explorer service spend found for the current month.</EmptyState>;
  }

  return (
    <div className="dash-billing-table">
      {insights.billing.byService.slice(0, 10).map((item) => {
        const percent = total > 0 ? Math.round((item.cost / total) * 100) : 0;
        return (
          <div key={item.service}>
            <div>
              <strong>{item.service}</strong>
              <span>{percent}% of current month spend</span>
            </div>
            <i>
              <b style={{ width: `${Math.min(percent, 100)}%` }} />
            </i>
            <em>${item.cost.toFixed(2)}</em>
          </div>
        );
      })}
    </div>
  );
}

function RecentAwsEvents({ insights }: { insights?: AwsInsights }) {
  const events = insights?.events ?? [];

  if (!events.length) {
    return <EmptyState>No AWS activity events synced yet. Grant CloudTrail lookup permission and run sync.</EmptyState>;
  }

  return (
    <div className="dash-event-list">
      {events.slice(0, 8).map((event, index) => (
        <div className="dash-event-row" key={event.id ?? `${event.name}-${index}`}>
          <div>
            <strong>{event.name ?? 'AWS event'}</strong>
            <span>{event.source ?? 'Unknown source'}</span>
          </div>
          <small>{event.username ?? 'AWS principal'}</small>
          <em>{event.at ? new Date(event.at).toLocaleString() : 'Recent'}</em>
        </div>
      ))}
    </div>
  );
}

function DashboardChart() {
  return (
    <div className="dash-chart">
      <div className="dash-chart-line" />
      <div className="dash-chart-bars">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="dash-chart-labels">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="dash-panel">
      <header>
        <h2>{title}</h2>
        {action && <button>{action}</button>}
      </header>
      {children}
    </section>
  );
}

function Code2Icon() {
  return <TerminalSquare size={16} />;
}

const clientRoleRank: Record<string, number> = {
  viewer: 1,
  devops: 2,
  architect: 3,
  admin: 4,
  owner: 5,
  superadmin: 6,
};

function canRoleWriteDiagrams(role?: string) {
  return (role ? clientRoleRank[role] ?? 0 : 0) >= clientRoleRank.architect;
}

function canRoleDeleteDiagrams(role?: string) {
  return (role ? clientRoleRank[role] ?? 0 : 0) >= clientRoleRank.admin;
}

function isTerraformImportFile(file: File) {
  return /\.(tf|hcl|tfvars|auto\.tfvars|tfvars\.json|env|json|ya?ml)$/i.test(file.name) || file.type === 'text/plain' || file.type === 'application/json';
}

function terraformImportMessage(files: File[]) {
  const moduleCount = files.filter((file) => /\.(tf|hcl)$/i.test(file.name)).length;
  const metadataCount = files.length - moduleCount;
  const fileLabel = files.length === 1 ? 'file' : 'files';

  if (!metadataCount) {
    return `Imported ${files.length} Terraform ${fileLabel} with generated topology boundaries.`;
  }

  return `Imported ${moduleCount} Terraform module ${moduleCount === 1 ? 'file' : 'files'} and scanned ${metadataCount} secret/config ${metadataCount === 1 ? 'file' : 'files'} for binding keys only.`;
}

function readFileAsText(file: File): Promise<{ name: string; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, content: String(reader.result ?? '') });
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.readAsText(file);
  });
}

export default DashboardShell;
