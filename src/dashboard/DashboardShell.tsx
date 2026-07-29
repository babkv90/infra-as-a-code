import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import Editor from '@monaco-editor/react';
import {
  Activity,
  ArrowRight,
  AlertTriangle,
  BadgeDollarSign,
  Bell,
  CheckCircle2,
  CloudCog,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  FilePlus2,
  FolderOpen,
  GitBranch,
  GitMerge,
  Github,
  History,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  MoreVertical,
  PencilLine,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import { useReactFlow } from 'reactflow';
import Canvas from '../components/Canvas';
import AppLogo from '../components/AppLogo';
import DeploymentModal from '../components/DeploymentModal';
import PropertiesPanel from '../components/PropertiesPanel';
import { PageAlert } from '../components/PageAlert';
import ResourceInfoViewer from '../components/ResourceInfoViewer';
import Sidebar from '../components/Sidebar';
import StatusBar from '../components/StatusBar';
import Toolbar from '../components/Toolbar';
import { getStoredUser, logout } from '../auth/authClient';
import { isEnterpriseDemoDiagram, loadDemoDiagrams } from '../data/enterpriseDemoSource';
import { useDiagramStore } from '../store/diagramStore';
import { normalizeTerraformFiles } from '../utils/importDiagram';
import { DeploymentLiveMonitor } from './components/DeploymentLiveMonitor';
import { EmptyState, Panel } from './components/DashPrimitives';
import {
  createSavedDiagram,
  deleteSavedDiagram,
  getSavedDiagram,
  listSavedDiagrams,
  updateSavedDiagram,
  updateSavedDiagramMeta,
  type SavedDiagram,
} from './diagramApi';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import {
  activeDiagrams,
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
  type DashboardPage,
} from './dashboardData';
import { TerraformPage } from './pages/TerraformPage';
import {
  getAwsInsights,
  listAwsAccounts,
  listAwsRegions,
  syncAwsAccount,
  type AwsAccountRecord,
  type AwsInsights,
} from './awsApi';
import { AgentPage } from './pages/AgentPage';
import { ConnectAwsPage } from './pages/ConnectAwsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { requestDemoCredits } from './superAdminApi';
import {
  cancelQueuedApplicationWorkflows,
  createApplicationPipeline,
  deleteApplicationPipeline,
  deployApplicationPipeline,
  forceStopApplicationDeployment,
  getApplicationDeploymentStatus,
  listApplicationPipelines,
  reportPipelineRunResult,
  syncPipelineToGithub,
  updateApplicationPipeline,
  type ApplicationDeploymentStatus,
  type ApplicationPipelineRecord,
} from './applicationPipelineApi';
import { listNotifications, markAllNotificationsRead, type NotificationRecord } from './notificationApi';
import { SupportPage } from './pages/SupportPage';
import {
  checkGithubRepositoryAccess,
  disconnectGithub,
  getGithubStatus,
  githubOAuthUrl,
  listGithubBranches,
  listGithubRepositories,
  type GithubBranch,
  type GithubConnection,
  type GithubRepository,
  type GithubRepositoryAccess,
} from '../github/githubApi';
import {
  applyDeployment,
  destroyDeployment,
  forceDestroyDeployment,
  getDeployment,
  listDeployments,
  MERGE_SOURCE_ELIGIBLE_STATUSES,
  MERGE_TARGET_ELIGIBLE_STATUSES,
  previewDeploymentMerge,
  renameDeployment,
  syncDeploymentDrift,
  verifyDeploymentResources,
  type DeploymentRecord,
  type ResourceVerificationResult,
} from '../utils/deploymentApi';
import { buildDeploymentResourceBundle } from '../utils/resourceRequirements';
import type { ValidationIssue } from '../utils/validate';
import { canUseAiAgent, canUseApplicationPipelines, serviceAccessTierForUser } from '../utils/accessControl';

// Still used by KpiGrid and ResourceTable's own detail popups even though the Runtime Lab page
// that originally introduced this type/component was removed — see RuntimeLabDetailModal below.
type RuntimeLabDetail = {
  title: string;
  subtitle: string;
  process: string;
  realTimeExample: string;
  steps: string[];
  codePath?: string;
};

const dashboardPageIds = new Set<DashboardPage>(dashboardNavItems.map((item) => item.id));

// Hidden for every user regardless of role/plan — no nav entry, and a direct/bookmarked
// ?view=terraform or ?view=security deep link falls back to Overview instead of rendering the
// page. Kept as a filter (not removed from DashboardPage/dashboardNavItems/renderPage) so the
// pages themselves stay intact and this is a one-line revert if they need to come back.
const hiddenDashboardPages = new Set<DashboardPage>(['terraform', 'security']);
const githubConnectionCacheKey = 'infraflow.github.connection';
const githubRepositoriesCacheKey = 'infraflow.github.repositories';

function readCachedGithubConnection(): GithubConnection {
  try {
    const cached = window.localStorage.getItem(githubConnectionCacheKey);
    if (!cached) return { connected: false, login: '', scopes: [] };
    const parsed = JSON.parse(cached) as GithubConnection;
    return parsed?.connected ? parsed : { connected: false, login: '', scopes: [] };
  } catch {
    return { connected: false, login: '', scopes: [] };
  }
}

function cacheGithubConnection(connection: GithubConnection) {
  if (connection.connected) {
    window.localStorage.setItem(githubConnectionCacheKey, JSON.stringify(connection));
  } else {
    window.localStorage.removeItem(githubConnectionCacheKey);
  }
  window.dispatchEvent(new CustomEvent('infraflow:github-connection-cache', { detail: connection }));
}

function readCachedGithubRepositories(): GithubRepository[] {
  try {
    const cached = window.localStorage.getItem(githubRepositoriesCacheKey);
    if (!cached) return [];
    const parsed = JSON.parse(cached) as GithubRepository[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cacheGithubRepositories(repositories: GithubRepository[]) {
  if (repositories.length) {
    window.localStorage.setItem(githubRepositoriesCacheKey, JSON.stringify(repositories));
  } else {
    window.localStorage.removeItem(githubRepositoriesCacheKey);
  }
}

function getInitialDashboardPage(): DashboardPage {
  const page = new URLSearchParams(window.location.search).get('view') as DashboardPage | null;
  return page && dashboardPageIds.has(page) && !hiddenDashboardPages.has(page) ? page : 'overview';
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
  const { showScrollHint } = useScrollHint([activePage]);
  const [awsAccounts, setAwsAccounts] = useState<AwsAccountRecord[]>([]);
  const [awsInsights, setAwsInsights] = useState<AwsInsights | undefined>();
  const [awsRegions, setAwsRegions] = useState<string[]>(['ap-south-1']);
  const [awsDataError, setAwsDataError] = useState('');
  const [awsDataMessage, setAwsDataMessage] = useState('');
  const [isSyncingAws, setIsSyncingAws] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const currentUser = getStoredUser();
  const visibleNavItems = useMemo(
    () =>
      dashboardNavItems.filter((item) => {
        if (hiddenDashboardPages.has(item.id)) return false;
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

  // pushState (not replaceState) so each dashboard-view switch becomes a real browser history
  // entry — otherwise the back button skips over every view change and exits the dashboard
  // entirely. The matching popstate listener below is what makes the back/forward buttons
  // actually update activePage instead of just changing the URL underneath a stale page.
  function goToDashboardPage(page: DashboardPage) {
    if (hiddenDashboardPages.has(page)) return;
    setActivePage(page);
    window.history.pushState(null, '', getDashboardUrl(page));
  }

  function goToResourceInfo(deploymentId: string) {
    setActivePage('resource-info');
    window.history.pushState(null, '', `/dashboard?view=resource-info&deployment=${encodeURIComponent(deploymentId)}`);
  }

  useEffect(() => {
    function handlePopState() {
      setActivePage(getInitialDashboardPage());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

  function goToNotificationTarget(item: NotificationRecord) {
    setIsNotificationsOpen(false);
    if (item.resourceType === 'Deployment') {
      goToResourceInfo(item.resourceId);
    } else if (item.resourceType === 'ApplicationPipeline') {
      goToDashboardPage('app-pipeline');
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

  useEffect(() => {
    if (!isNotificationsOpen) return undefined;

    function handleOutsidePointerDown(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [isNotificationsOpen]);

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
            <LiveUpdatesLauncher activePage={activePage} />
            <div className="dash-notifications" ref={notificationsRef}>
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
                        <li
                          className={`dash-notification-item dash-notification-item--${item.status}`}
                          key={item._id}
                          onClick={() => goToNotificationTarget(item)}
                        >
                          {item.status === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                          <div>
                            <strong>{item.title}</strong>
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
        {awsDataError && <PageAlert message={awsDataError} tone="error" onDismiss={() => setAwsDataError('')} />}
        {awsDataMessage && <PageAlert message={awsDataMessage} onDismiss={() => setAwsDataMessage('')} />}
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
        {showScrollHint && <ScrollHintIcon />}
      </section>
      <DeploymentLiveMonitor />
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

const LIVE_INFRA_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying', 'destroying'];
const LIVE_APP_RUN_STATUSES = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const liveDeploymentStartedEvent = 'infraflow:deployment-started';
const appPipelineDeploymentRunningEvent = 'infraflow:app-pipeline-deployments-running';
const appPipelineDeploymentRunningKey = 'infraflow.running.appPipelineDeployments';
const appPipelineDeploymentRunningMaxAgeMs = 2 * 60 * 60 * 1000;

function readRunningAppPipelineIds() {
  try {
    const now = Date.now();
    const records = JSON.parse(window.localStorage.getItem(appPipelineDeploymentRunningKey) || '[]') as Array<{ id: string; startedAt: number }>;
    const activeRecords = records.filter((record) => record.id && now - Number(record.startedAt || 0) < appPipelineDeploymentRunningMaxAgeMs);
    if (activeRecords.length !== records.length) window.localStorage.setItem(appPipelineDeploymentRunningKey, JSON.stringify(activeRecords));
    return activeRecords.map((record) => record.id);
  } catch {
    return [];
  }
}

function writeRunningAppPipelineIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const now = Date.now();
  const existing = readRunningAppPipelineIds();
  const records = uniqueIds.map((id) => ({
    id,
    startedAt: existing.includes(id) ? now - 1 : now,
  }));
  window.localStorage.setItem(appPipelineDeploymentRunningKey, JSON.stringify(records));
  window.dispatchEvent(new CustomEvent(appPipelineDeploymentRunningEvent, { detail: uniqueIds }));
}

function markAppPipelineDeploymentRunning(id: string) {
  writeRunningAppPipelineIds([...readRunningAppPipelineIds(), id]);
}

function clearAppPipelineDeploymentRunning(id?: string) {
  if (!id) return;
  writeRunningAppPipelineIds(readRunningAppPipelineIds().filter((runningId) => runningId !== id));
}

type LiveAppStatusRecord = {
  status?: ApplicationDeploymentStatus;
  error?: string;
  checkedAt: number;
};

function LiveUpdatesLauncher({ activePage }: { activePage: DashboardPage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [pipelines, setPipelines] = useState<ApplicationPipelineRecord[]>([]);
  const [appStatuses, setAppStatuses] = useState<Record<string, LiveAppStatusRecord>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const liveRefreshRef = useRef<{ inFlight: boolean; lastStartedAt: number; backoffUntil: number }>({ inFlight: false, lastStartedAt: 0, backoffUntil: 0 });
  const currentUser = getStoredUser();

  async function refreshLiveUpdates() {
    const now = Date.now();
    if (liveRefreshRef.current.inFlight || now < liveRefreshRef.current.backoffUntil || now - liveRefreshRef.current.lastStartedAt < 3000) return;
    liveRefreshRef.current.inFlight = true;
    liveRefreshRef.current.lastStartedAt = now;
    setIsLoading(true);
    try {
      const [deploymentData, pipelineData] = await Promise.all([listDeployments(), listApplicationPipelines()]);
      setDeployments(deploymentData);
      setPipelines(pipelineData);
      setError('');

      const runningAppPipelineIds = readRunningAppPipelineIds();
      const statusEntries = await Promise.all(
        pipelineData
          .filter((pipeline) => runningAppPipelineIds.includes(pipeline._id))
          .filter((pipeline) => parseGithubRepositoryUrl(pipeline.repository.url))
          .map(async (pipeline) => {
            const repository = parseGithubRepositoryUrl(pipeline.repository.url);
            if (!repository) return [pipeline._id, { checkedAt: Date.now() }] as const;
            try {
              const status = await getApplicationDeploymentStatus(pipeline._id, {
                owner: repository.owner,
                repo: repository.repo,
                branch: pipeline.repository.branch || 'main',
              });
              if (status.run?.status && LIVE_APP_RUN_STATUSES.has(status.run.status)) {
                markAppPipelineDeploymentRunning(pipeline._id);
              } else if (status.run?.status === 'completed') {
                clearAppPipelineDeploymentRunning(pipeline._id);
              }
              return [pipeline._id, { status, checkedAt: Date.now() }] as const;
            } catch (statusError) {
              return [
                pipeline._id,
                {
                  error: statusError instanceof Error ? statusError.message : 'Unable to read app pipeline status.',
                  checkedAt: Date.now(),
                },
              ] as const;``
            }
          }),
      );
      setAppStatuses((current) => ({ ...current, ...Object.fromEntries(statusEntries) }));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load live updates.';
      const isRateLimited = message.includes('429') || message.toLowerCase().includes('too many');
      if (isRateLimited) liveRefreshRef.current.backoffUntil = Date.now() + 30000;
      setError(isRateLimited ? 'Too many live update requests. Pausing refresh briefly.' : message);
    } finally {
      liveRefreshRef.current.inFlight = false;
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setIsOpen(false);
    setError('');
  }, [activePage]);

  useEffect(() => {
    if (!isOpen) return undefined;
    void refreshLiveUpdates();
    const interval = window.setInterval(() => void refreshLiveUpdates(), 15000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    function handleDeploymentStarted() {
      liveRefreshRef.current.backoffUntil = 0;
      liveRefreshRef.current.lastStartedAt = 0;
      void refreshLiveUpdates();
    }

    window.addEventListener(liveDeploymentStartedEvent, handleDeploymentStarted);
    return () => window.removeEventListener(liveDeploymentStartedEvent, handleDeploymentStarted);
  }, []);

  const liveInfraItems = deployments.filter((deployment) => LIVE_INFRA_STATUSES.includes(deployment.status));
  const liveAppItems = pipelines
    .map((pipeline) => ({ pipeline, status: appStatuses[pipeline._id] }))
    .filter(({ status }) => {
      const runStatus = status?.status?.run?.status;
      return runStatus ? LIVE_APP_RUN_STATUSES.has(runStatus) : false;
    });
  const liveItems = [
    ...liveInfraItems.map((deployment) => ({
      id: `infra-${deployment._id}`,
      actor: actorLabel(deployment.requestedBy, currentUser),
      name: deployment.name,
      percent: infraCompletionPercent(deployment),
      status: deploymentStatusLabel(deployment.status),
      type: 'Infra',
    })),
    ...liveAppItems.map(({ pipeline, status }) => ({
      id: `app-${pipeline._id}`,
      actor: actorLabel(pipeline.createdBy, currentUser),
      name: pipeline.name,
      percent: appCompletionPercent(status?.status?.run?.status),
      status: appRunStatusLabel(status?.status?.run?.status),
      type: 'App',
    })),
  ];
  const activeCount = liveItems.length;

  return (
    <div className="live-updates">
      {isOpen && (
        <section className="live-updates-panel" aria-label="Live deployment updates">
          <header>
            <div>
              <span className="dash-eyebrow">Live deployments</span>
              <strong>{activeCount ? `${activeCount} running` : 'No running deployments'}</strong>
            </div>
            <div className="live-updates-panel__actions">
              <button aria-label="Refresh live updates" disabled={isLoading} onClick={() => void refreshLiveUpdates()} type="button">
                <RefreshCw size={14} />
              </button>
              <button aria-label="Close live updates" onClick={() => setIsOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>
          </header>

          {error && <div className="live-updates-error">{error}</div>}

          {liveItems.length ? (
            <div className="live-updates-list">
              {liveItems.map((item) => (
                <LiveUpdateRow actor={item.actor} key={item.id} name={item.name} percent={item.percent} status={item.status} type={item.type} />
              ))}
            </div>
          ) : (
            <p className="live-updates-empty">{isLoading ? 'Checking live deployments...' : 'No infrastructure or application deployment is running right now.'}</p>
          )}
        </section>
      )}

      <button
        className={`live-updates-launcher ${activeCount ? 'live-updates-launcher--active' : ''}`}
        onClick={() => {
          setIsOpen((value) => !value);
        }}
        type="button"
      >
        <span className="live-updates-launcher__orb">
          <Activity size={21} />
          {activeCount > 0 && <i>{activeCount}</i>}
        </span>
        <span>
          <strong>Live update</strong>
          <small>{activeCount ? `${activeCount} running` : '0 running'}</small>
        </span>
      </button>
    </div>
  );
}

function LiveUpdateRow({ actor, name, percent, status, type }: { actor: string; name: string; percent: number; status: string; type: string }) {
  return (
    <article className="live-update-row">
      <div className="live-update-row__top">
        <span>{type}</span>
        <b>{percent}%</b>
      </div>
      <strong>{name}</strong>
      <small>Deploying by {actor}</small>
      <div className="live-update-row__progress" aria-label={`${status}: ${percent}% complete`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <em>{status}</em>
    </article>
  );
}

function actorLabel(actor: DeploymentRecord['requestedBy'] | ApplicationPipelineRecord['createdBy'], fallbackUser: ReturnType<typeof getStoredUser>) {
  if (actor && typeof actor === 'object') return actor.name || actor.email || 'Unknown user';
  return fallbackUser?.name || fallbackUser?.email || 'Unknown user';
}

function infraCompletionPercent(deployment: DeploymentRecord) {
  if (deployment.status === 'queued') return 10;
  if (deployment.status === 'destroying') return deployment.activeRun?.githubRunId ? 65 : 45;
  if (deployment.status === 'deploying') return deployment.activeRun?.githubRunId ? 70 : 50;
  return 0;
}

function appCompletionPercent(status?: string) {
  switch (status) {
    case 'queued':
    case 'requested':
    case 'waiting':
    case 'pending':
      return 20;
    case 'in_progress':
      return 65;
    default:
      return 10;
  }
}

function appRunStatusLabel(status?: string) {
  if (!status) return 'Starting';
  return status.replace(/_/g, ' ');
}
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
    case 'diagrams':
      return <DiagramsPage />;
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
    case 'infra-pipeline':
      return <InfraDeploymentPipelinePage insights={awsContext.awsInsights} />;
    case 'app-pipeline':
      return <ApplicationPipelinePage />;
    case 'security':
      return <SecurityPage insights={awsContext.awsInsights} />;
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
  const [mergeSourceDeploymentId, setMergeSourceDeploymentId] = useState<string>();
  const [mergeImportedNodeIds, setMergeImportedNodeIds] = useState<string[]>();
  const [demoDiagrams, setDemoDiagrams] = useState<SavedDiagram[]>([]);
  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>([]);
  const [currentDiagramId, setCurrentDiagramId] = useState<string>();
  const [currentDiagramName, setCurrentDiagramName] = useState('Untitled diagram');
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [isSavingDiagram, setIsSavingDiagram] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState('');
  const [creditMessage, setCreditMessage] = useState('');
  const { nodes, edges, issues, activeRegion, validate, setDark, importDiagram, markSaved, isDirty } = useDiagramStore();
  const user = getStoredUser();
  const canWriteDiagrams = canRoleWriteDiagrams(user?.role);
  const canDeleteDiagrams = canRoleDeleteDiagrams(user?.role);
  const accessTier = serviceAccessTierForUser(user);
  const directoryDiagrams = useMemo(() => [...demoDiagrams, ...savedDiagrams], [demoDiagrams, savedDiagrams]);
  // Only templates + demo diagrams are offered from this dropdown — user-saved diagrams live on
  // their own management page (DiagramsPage) instead, so "hasOpenableDiagrams" (and the select's
  // disabled/placeholder state) only needs to reflect what's actually rendered in it below.
  const hasOpenableDiagrams = commonInfraTemplates.length > 0 || demoDiagrams.length > 0;
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

  // The diagram store has no persist middleware (see diagramStore.ts) — a refresh or closed tab
  // silently discards everything since the last save, including the full undo history. This is
  // the only guard against that; it only fires while there's an actual unsaved change (isDirty).
  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

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

  // Merge entry point: ?mergeInto=<target deployment id>&mergeSource=<source deployment id>, set by
  // the "Merge into..." action in DeploymentsPage below. Loads the server-computed merge preview
  // (target's nodes/edges plus the source's, id-remapped) onto the canvas and focuses the imported
  // nodes so the user can see exactly what needs a connecting edge drawn to the existing
  // infrastructure before the merge can be submitted (see DeploymentModal's merge mode).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetDeploymentId = params.get('mergeInto');
    const sourceDeploymentId = params.get('mergeSource');
    if (!targetDeploymentId || !sourceDeploymentId) return;

    window.history.replaceState(null, '', '/dashboard?view=builder');

    previewDeploymentMerge(targetDeploymentId, sourceDeploymentId)
      .then((preview) => {
        importDiagram({ nodes: preview.nodes, edges: preview.edges });
        setCurrentDiagramId(undefined);
        setCurrentDiagramName('Merged infrastructure');
        setUpdateDeploymentId(preview.targetDeploymentId);
        setMergeSourceDeploymentId(preview.sourceDeploymentId);
        setMergeImportedNodeIds(preview.importedNodeIds);
        setIsDeploymentPageOpen(true);
        fitFullDiagram();
      })
      .catch((error) => {
        setDirectoryMessage(error instanceof Error ? error.message : 'Unable to prepare that merge.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from the "Saved Diagrams" management page (DiagramsPage below), which lists every saved
  // diagram on its own page instead of cramming them into the "Open" dropdown here. Fetches the
  // diagram directly by id rather than depending on directoryDiagrams having finished loading yet.
  useEffect(() => {
    const diagramId = new URLSearchParams(window.location.search).get('openDiagram');
    if (!diagramId) return;

    window.history.replaceState(null, '', '/dashboard?view=builder');

    getSavedDiagram(diagramId)
      .then((diagram) => {
        importDiagram({ nodes: diagram.nodes ?? [], edges: diagram.edges ?? [] });
        setCurrentDiagramId(diagram._id);
        setCurrentDiagramName(diagram.name);
        fitFullDiagram();
      })
      .catch((error) => {
        setDirectoryMessage(error instanceof Error ? error.message : 'Unable to open that diagram.');
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
    clearDeploymentEditContext();
    setDirectoryMessage(`Opened ${diagram.name}`);
    fitFullDiagram();
  }

  function openInfraTemplate(templateId: string) {
    const template = commonInfraTemplates.find((item) => item.id === templateId);
    if (!template) return;

    importDiagram(template.snapshot);
    setCurrentDiagramId(templateDiagramId(template.id));
    setCurrentDiagramName(template.name);
    clearDeploymentEditContext();
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
    clearDeploymentEditContext();
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
      clearDeploymentEditContext();
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

  function clearDeploymentEditContext() {
    setUpdateDeploymentId(undefined);
    setMergeSourceDeploymentId(undefined);
    setMergeImportedNodeIds(undefined);
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
          mergeSourceDeploymentId={mergeSourceDeploymentId}
          mergeImportedNodeIds={mergeImportedNodeIds}
          defaultName={currentDiagramId && currentDiagramName !== 'Untitled diagram' ? currentDiagramName : undefined}
          onClose={() => {
            setIsDeploymentPageOpen(false);
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
                {demoDiagrams.length > 0 && (
                  <optgroup label="Demo diagrams">
                    {demoDiagrams.map((diagram) => (
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
            <button
              className="dash-secondary-action"
              onClick={() => {
                window.location.href = '/dashboard?view=diagrams';
              }}
              title="Browse, rename, and edit every saved diagram on its own page."
              type="button"
            >
              <FolderOpen size={15} />
              Manage saved diagrams
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

// Lists every saved diagram (excluding read-only demo diagrams and application templates, which
// stay in the builder's "Open" dropdown) with inline editing for name/description/region/tags —
// replaces cramming the full list into that dropdown.
function DiagramsPage() {
  const [diagrams, setDiagrams] = useState<SavedDiagram[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editingDiagramId, setEditingDiagramId] = useState<string>();
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editTags, setEditTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeleteDiagram, setPendingDeleteDiagram] = useState<SavedDiagram | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setIsLoading(true);
    setError('');
    try {
      setDiagrams(await listSavedDiagrams());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load saved diagrams.');
    } finally {
      setIsLoading(false);
    }
  }

  function startEditing(diagram: SavedDiagram) {
    setEditingDiagramId(diagram._id);
    setEditName(diagram.name);
    setEditDescription(diagram.description ?? '');
    setEditRegion(diagram.activeRegion ?? '');
    setEditTags((diagram.tags ?? []).join(', '));
    setMessage('');
    setError('');
  }

  function cancelEditing() {
    setEditingDiagramId(undefined);
  }

  async function saveEditing(diagram: SavedDiagram) {
    const trimmedName = editName.trim();
    if (trimmedName.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }

    setIsSaving(true);
    setError('');
    try {
      const updated = await updateSavedDiagramMeta(diagram._id, {
        name: trimmedName,
        description: editDescription.trim(),
        activeRegion: editRegion.trim() || undefined,
        tags: editTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setDiagrams((items) => items.map((item) => (item._id === updated._id ? updated : item)));
      setMessage(`Saved "${updated.name}".`);
      setEditingDiagramId(undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save changes.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(diagram: SavedDiagram) {
    setIsDeleting(true);
    setError('');
    try {
      await deleteSavedDiagram(diagram._id);
      setDiagrams((items) => items.filter((item) => item._id !== diagram._id));
      setPendingDeleteDiagram(null);
      setMessage(`Deleted "${diagram.name}".`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this diagram.');
    } finally {
      setIsDeleting(false);
    }
  }

  function openInBuilder(diagram: SavedDiagram) {
    window.location.href = `/dashboard?view=builder&openDiagram=${encodeURIComponent(diagram._id)}`;
  }

  return (
    <div className="dash-page dash-page--diagrams">
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      <header className="pipeline-console-header">
        <div>
          <span className="dash-eyebrow">Diagram directory</span>
          <h2>Saved diagrams</h2>
        </div>
        <div className="pipeline-header-badges">
          <button className="dash-secondary-action" disabled={isLoading} onClick={() => void refresh()} type="button">
            <RefreshCw size={15} />
            Refresh
          </button>
          <button
            className="pipeline-primary-compact"
            onClick={() => {
              window.location.href = '/dashboard?view=builder';
            }}
            type="button"
          >
            <FilePlus2 size={14} />
            New diagram
          </button>
        </div>
      </header>
      <section className="deploy-table-panel">
        <header>
          <strong>Saved diagrams</strong>
          <span>{diagrams.length} shown</span>
        </header>
        <div className="dash-deploy-table-wrap">
          {diagrams.length ? (
            <table className="dash-deploy-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Region</th>
                  <th>Tags</th>
                  <th>Resources</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {diagrams.map((diagram) => {
                  const isEditing = editingDiagramId === diagram._id;
                  return (
                    <Fragment key={diagram._id}>
                      <tr className="dash-deploy-table-row">
                        <td>
                          <button className="dash-deploy-name-button" onClick={() => openInBuilder(diagram)} type="button">
                            <strong>{diagram.name}</strong>
                            <span>{diagram.description || 'No description'}</span>
                          </button>
                        </td>
                        <td>{diagram.activeRegion ?? 'region unknown'}</td>
                        <td>{(diagram.tags ?? []).join(', ') || '—'}</td>
                        <td>{diagram.nodes?.length ?? 0}</td>
                        <td>{diagram.updatedAt ? new Date(diagram.updatedAt).toLocaleString() : '—'}</td>
                        <td>
                          <div className="dash-deploy-table-actions">
                            <button className="dash-secondary-action" onClick={() => openInBuilder(diagram)} type="button">
                              <Workflow size={15} />
                              Open
                            </button>
                            <button className="dash-secondary-action" onClick={() => (isEditing ? cancelEditing() : startEditing(diagram))} type="button">
                              <Edit3 size={15} />
                              {isEditing ? 'Cancel' : 'Edit'}
                            </button>
                            <button className="dash-secondary-action dash-danger-action" onClick={() => setPendingDeleteDiagram(diagram)} type="button">
                              <Trash2 size={15} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="dash-deploy-table-detail-row">
                          <td colSpan={6}>
                            <div className="dash-diagram-edit-form">
                              <label>
                                <span>Name</span>
                                <input value={editName} onChange={(event) => setEditName(event.target.value)} />
                              </label>
                              <label>
                                <span>Description</span>
                                <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                              </label>
                              <label>
                                <span>Region</span>
                                <input value={editRegion} onChange={(event) => setEditRegion(event.target.value)} placeholder="e.g. ap-south-1" />
                              </label>
                              <label>
                                <span>Tags (comma separated)</span>
                                <input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="prod, backend" />
                              </label>
                              <div className="dash-diagram-edit-form__actions">
                                <button className="dash-secondary-action" disabled={isSaving} onClick={cancelEditing} type="button">
                                  Cancel
                                </button>
                                <button className="deployment-primary" disabled={isSaving} onClick={() => void saveEditing(diagram)} type="button">
                                  {isSaving ? 'Saving...' : 'Save changes'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState>No saved diagrams yet. Save one from the visual builder to see it here.</EmptyState>
          )}
        </div>
      </section>
      {pendingDeleteDiagram && (
        <div className="dash-destroy-dialog-backdrop" role="presentation" onClick={() => !isDeleting && setPendingDeleteDiagram(null)}>
          <section
            aria-labelledby="dash-diagram-delete-title"
            aria-modal="true"
            className="dash-destroy-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>
                <Trash2 size={22} />
              </span>
              <button aria-label="Close delete confirmation" className="dash-icon-button" disabled={isDeleting} onClick={() => setPendingDeleteDiagram(null)} type="button">
                <X size={16} />
              </button>
            </header>
            <div className="dash-destroy-dialog__body">
              <h2 id="dash-diagram-delete-title">Delete this diagram?</h2>
              <p>
                This permanently deletes <strong>{pendingDeleteDiagram.name}</strong>. This cannot be undone. If a deployment was created from this
                diagram, it will lose the ability to be Updated or Merged into afterward — its existing AWS resources are not affected.
              </p>
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={isDeleting} onClick={() => setPendingDeleteDiagram(null)} type="button">
                Cancel
              </button>
              <button className="dash-secondary-action dash-danger-action" disabled={isDeleting} onClick={() => void handleDelete(pendingDeleteDiagram)} type="button">
                <Trash2 size={15} />
                {isDeleting ? 'Deleting...' : 'Delete diagram'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
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
  const [driftSyncingDeploymentId, setDriftSyncingDeploymentId] = useState<string>();
  const [pendingMergeSourceDeployment, setPendingMergeSourceDeployment] = useState<DeploymentRecord | null>(null);
  const [renamingDeploymentId, setRenamingDeploymentId] = useState<string>();
  const [applyingDeploymentId, setApplyingDeploymentId] = useState<string>();
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<string>();
  const [destroyHistoryDeployment, setDestroyHistoryDeployment] = useState<DeploymentRecord | null>(null);
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

  async function handleRename(deployment: DeploymentRecord) {
    const nextName = window.prompt('Rename deployment', deployment.name);
    const trimmed = (nextName ?? '').trim();
    if (!trimmed || trimmed === deployment.name) return;

    setMessage('');
    setError('');
    setRenamingDeploymentId(deployment._id);
    try {
      const updatedDeployment = await renameDeployment(deployment._id, trimmed);
      setDeploymentRecords((records) => records.map((item) => (item._id === updatedDeployment._id ? updatedDeployment : item)));
      setMessage(`Renamed to "${updatedDeployment.name}".`);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Unable to rename this deployment.');
    } finally {
      setRenamingDeploymentId(undefined);
    }
  }

  async function handleApply(deployment: DeploymentRecord) {
    setMessage('');
    setError('');
    setApplyingDeploymentId(deployment._id);
    try {
      const updatedDeployment = await applyDeployment(deployment._id);
      setDeploymentRecords((records) => records.map((item) => (item._id === updatedDeployment._id ? updatedDeployment : item)));
      setMessage(`Apply started for "${updatedDeployment.name}".`);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply this deployment.');
    } finally {
      setApplyingDeploymentId(undefined);
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

  async function handleSyncDrift(deployment: DeploymentRecord) {
    setMessage('');
    setError('');
    setDriftSyncingDeploymentId(deployment._id);
    try {
      const drift = await syncDeploymentDrift(deployment._id);
      setDeploymentRecords((records) => records.map((item) => (item._id === deployment._id ? { ...item, drift } : item)));
      setMessage(drift.status === 'drifted' ? `AWS drift found ${drift.summary.changed} changed Terraform-managed resource(s) in ${deployment.name}.` : `${deployment.name} is in sync with AWS.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync AWS drift.');
    } finally {
      setDriftSyncingDeploymentId(undefined);
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
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
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
                          {deployment.drift?.checkedAt && (
                            <span className={`dash-drift-pill dash-drift-pill--${deployment.drift.status}`}>{deploymentDriftStatusLabel(deployment.drift.status)}</span>
                          )}
                        </td>
                        <td>{deployment.resourceCount}</td>
                        <td>{deployment.connectionCount}</td>
                        <td>{deployment.diagram?.activeRegion ?? 'region unknown'}</td>
                        <td>{formatDeploymentDate(deployment)}</td>
                        <td>
                          <div className="dash-deploy-table-actions">
                            {deployment.status === 'draft' && (
                              <button
                                className="dash-secondary-action"
                                disabled={applyingDeploymentId === deployment._id}
                                onClick={() => void handleApply(deployment)}
                                title="Run Terraform apply for this saved draft against its selected AWS account."
                                type="button"
                              >
                                <Rocket size={15} />
                                {applyingDeploymentId === deployment._id ? 'Applying...' : 'Apply'}
                              </button>
                            )}
                            <button
                              className="dash-secondary-action"
                              disabled={renamingDeploymentId === deployment._id}
                              onClick={() => void handleRename(deployment)}
                              title="Change this deployment's display name. Doesn't touch its diagram, Terraform config, or AWS resources."
                              type="button"
                            >
                              <Edit3 size={15} />
                              {renamingDeploymentId === deployment._id ? 'Renaming...' : 'Rename'}
                            </button>
                            {deployment.status !== 'draft' && (
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
                            )}
                            {MERGE_SOURCE_ELIGIBLE_STATUSES.includes(deployment.status) && (
                              <button
                                className="dash-secondary-action dash-nowrap-action"
                                disabled={!deploymentRecords.some((candidate) => MERGE_TARGET_ELIGIBLE_STATUSES.includes(candidate.status) && candidate._id !== deployment._id)}
                                onClick={() => setPendingMergeSourceDeployment(deployment)}
                                title="Attach this not-yet-deployed diagram onto an already-deployed infrastructure's stack, instead of deploying it as a separate stack."
                                type="button"
                              >
                                <GitMerge size={15} />
                                Merge into...
                              </button>
                            )}
                            {deployment.status !== 'draft' &&
                              (FORCE_DESTROY_STATUSES.includes(deployment.status) ? (
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
                              ))}
                            <details className="dash-row-more-menu">
                              <summary className="dash-icon-button" aria-label={`More actions for ${deployment.name}`} title="More actions">
                                <MoreVertical size={16} />
                              </summary>
                              <div className="dash-row-more-menu__content">
                                <button onClick={() => setExpandedDeploymentId(isExpanded ? undefined : deployment._id)} type="button">
                                  <Eye size={15} />
                                  {isExpanded ? 'Hide details' : 'Details'}
                                </button>
                                <button disabled={isLoadingDeployments} onClick={() => void refreshDeployments()} type="button">
                                  <RefreshCw size={15} />
                                  Refresh
                                </button>
                                {['deployed', 'failed'].includes(deployment.status) && (
                                  <button
                                    disabled={driftSyncingDeploymentId === deployment._id}
                                    onClick={() => void handleSyncDrift(deployment)}
                                    title="Refresh Terraform state from AWS and store a drift report. This never applies changes."
                                    type="button"
                                  >
                                    <CloudCog size={15} />
                                    {driftSyncingDeploymentId === deployment._id ? 'Syncing drift...' : 'Sync AWS drift'}
                                  </button>
                                )}
                                {extractDestroyAttempts(deployment.logs).length > 0 && (
                                  <button
                                    onClick={() => setDestroyHistoryDeployment(deployment)}
                                    title="See why a destroy attempt failed, and every past attempt for this deployment."
                                    type="button"
                                  >
                                    <History size={15} />
                                    Destroy logs
                                  </button>
                                )}
                              </div>
                            </details>
                          </div>
                        </td>
                      </tr>
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

      </div>

      <div className="deploy-bottom-panels">
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
      {pendingMergeSourceDeployment && (
        <div className="dash-destroy-dialog-backdrop" role="presentation" onClick={() => setPendingMergeSourceDeployment(null)}>
          <section
            aria-labelledby="dash-merge-dialog-title"
            aria-modal="true"
            className="dash-destroy-dialog"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>
                <GitMerge size={22} />
              </span>
              <button aria-label="Close merge picker" className="dash-icon-button" onClick={() => setPendingMergeSourceDeployment(null)} type="button">
                <X size={16} />
              </button>
            </header>
            <div className="dash-destroy-dialog__body">
              <h2 id="dash-merge-dialog-title">Merge "{pendingMergeSourceDeployment.name}" into...</h2>
              <p>
                This diagram hasn't been applied to AWS yet, so its resources can be attached directly onto an already-deployed stack instead of
                becoming a separate deployment. Pick which deployment to merge into, then draw a connection from an imported resource to an
                existing one before applying.
              </p>
              {(() => {
                const eligibleTargets = deploymentRecords.filter(
                  (candidate) => MERGE_TARGET_ELIGIBLE_STATUSES.includes(candidate.status) && candidate._id !== pendingMergeSourceDeployment._id,
                );
                if (!eligibleTargets.length) {
                  return <p className="deployment-note">No deployed (or previously failed) infrastructure is available to merge into yet.</p>;
                }
                return (
                  <div className="dash-merge-target-list">
                    {eligibleTargets.map((target) => (
                      <button
                        className="dash-merge-target-option"
                        key={target._id}
                        onClick={() => {
                          window.location.href = `/dashboard?view=builder&mergeSource=${encodeURIComponent(pendingMergeSourceDeployment._id)}&mergeInto=${encodeURIComponent(target._id)}`;
                        }}
                        type="button"
                      >
                        <strong>{target.name}</strong>
                        <span>
                          {deploymentStatusLabel(target.status)} - {target.diagram?.activeRegion ?? 'region unknown'} - {target.resourceCount} resources
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <footer>
              <button className="dash-secondary-action" onClick={() => setPendingMergeSourceDeployment(null)} type="button">
                Cancel
              </button>
            </footer>
          </section>
        </div>
      )}
      {destroyHistoryDeployment && (
        <DestroyHistoryModal
          deployment={deploymentRecords.find((item) => item._id === destroyHistoryDeployment._id) ?? destroyHistoryDeployment}
          onClose={() => setDestroyHistoryDeployment(null)}
        />
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
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
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
  { id: 'serverless-api', label: 'Node.js Lambda API' },
  { id: 'kubernetes-service', label: 'Kubernetes service' },
];

function InfraDeploymentPipelinePage({ insights }: { insights?: AwsInsights }) {
  const user = getStoredUser();
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [pipelines, setPipelines] = useState<ApplicationPipelineRecord[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [name, setName] = useState('Production application pipeline');
  const [appType, setAppType] = useState('react-app');
  const [environment, setEnvironment] = useState<'development' | 'test' | 'staging' | 'production'>('development');
  const [branch, setBranch] = useState('main');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubConnection, setGithubConnection] = useState<GithubConnection>(readCachedGithubConnection);
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>(readCachedGithubRepositories);
  const [githubBranches, setGithubBranches] = useState<GithubBranch[]>([]);
  const [selectedGithubRepo, setSelectedGithubRepo] = useState('');
  const [installCommand, setInstallCommand] = useState('npm ci');
  const [testCommand, setTestCommand] = useState('npm test -- --watch=false');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [startCommand, setStartCommand] = useState('npm start');
  const [targetRegion, setTargetRegion] = useState('ap-south-1');
  const [lambdaFunctionName, setLambdaFunctionName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGithubBranchesLoading, setIsGithubBranchesLoading] = useState(false);
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);
  const [githubAccess, setGithubAccess] = useState<GithubRepositoryAccess>();
  const [isCheckingGithubAccess, setIsCheckingGithubAccess] = useState(false);
  const [deletingPipelineId, setDeletingPipelineId] = useState('');
  const [pendingDeletePipeline, setPendingDeletePipeline] = useState<ApplicationPipelineRecord | null>(null);
  const [pendingBulkDeletePipelines, setPendingBulkDeletePipelines] = useState<ApplicationPipelineRecord[]>([]);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [activePreviewTab, setActivePreviewTab] = useState<'overview' | 'workflow' | 'files' | 'activity'>('overview');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<ApplicationDeploymentStatus>();
  const [isDeployingApplication, setIsDeployingApplication] = useState(false);
  const deployingApplicationRef = useRef(false);
  const [runningPipelineIds, setRunningPipelineIds] = useState<string[]>(readRunningAppPipelineIds);
  const runningPipelineKey = runningPipelineIds.join('|');
  const [forceStoppingPipelineId, setForceStoppingPipelineId] = useState('');
  const [cancellingQueuedPipelineId, setCancellingQueuedPipelineId] = useState('');
  const [isPollingDeployment, setIsPollingDeployment] = useState(false);
  const [resourceHealthDeployment, setResourceHealthDeployment] = useState<DeploymentRecord>();
  const [resourceHealthPipelineName, setResourceHealthPipelineName] = useState('');
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
  const syncedPipelineCount = pipelines.filter((pipeline) => pipeline.repository.lastSyncedAt).length;
  const lambdaPipelineCount = pipelines.filter((pipeline) => pipeline.target.type === 'lambda').length;
  const provisionedRoleCount = pipelines.filter((pipeline) => pipeline.awsDeployRole?.status === 'provisioned').length;
  const resourceHealthMetrics = resourceHealthDeployment ? buildDeploymentResourceMetrics(resourceHealthDeployment, insights) : [];
  const selectedPipelines = pipelines.filter((pipeline) => selectedPipelineIds.includes(pipeline._id));
  const areAllPipelinesSelected = pipelines.length > 0 && selectedPipelineIds.length === pipelines.length;

  async function refreshPipelineData() {
    setIsLoading(true);
    try {
      const pipelineData = await listApplicationPipelines();
      setPipelines(pipelineData);
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
    void refreshGithubConnection({ silent: true });

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
    function handleGithubConnectionCache(event: Event) {
      const nextConnection = (event as CustomEvent<GithubConnection>).detail;
      if (nextConnection) setGithubConnection(nextConnection);
    }

    window.addEventListener('infraflow:github-connection-cache', handleGithubConnectionCache);
    return () => window.removeEventListener('infraflow:github-connection-cache', handleGithubConnectionCache);
  }, []);

  useEffect(() => {
    function handleRunningPipelinesChanged() {
      setRunningPipelineIds(readRunningAppPipelineIds());
    }

    window.addEventListener(appPipelineDeploymentRunningEvent, handleRunningPipelinesChanged);
    return () => window.removeEventListener(appPipelineDeploymentRunningEvent, handleRunningPipelinesChanged);
  }, []);

  useEffect(() => {
    if (!selectedPipeline || !runningPipelineIds.includes(selectedPipeline._id)) return;
    if (deploymentStatus?.run && deploymentStatus.run.status !== 'completed') return;

    const repository = parseGithubRepositoryUrl(selectedPipeline.repository.url);
    if (!repository) return;

    setGithubOwner(repository.owner);
    setGithubRepo(repository.repo);
    setBranch(selectedPipeline.repository.branch || 'main');
    setActivePreviewTab('activity');

    let isCurrent = true;
    setIsPollingDeployment(true);
    void getApplicationDeploymentStatus(selectedPipeline._id, {
      owner: repository.owner,
      repo: repository.repo,
      branch: selectedPipeline.repository.branch || 'main',
    })
      .then((status) => {
        if (!isCurrent) return;
        setDeploymentStatus(status);
        if (status.run?.status === 'completed') clearAppPipelineDeploymentRunning(selectedPipeline._id);
        else if (status.run?.status && LIVE_APP_RUN_STATUSES.has(status.run.status)) markAppPipelineDeploymentRunning(selectedPipeline._id);
        setRunningPipelineIds(readRunningAppPipelineIds());
      })
      .catch(() => {
        if (isCurrent) setRunningPipelineIds(readRunningAppPipelineIds());
      })
      .finally(() => {
        if (isCurrent) setIsPollingDeployment(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [deploymentStatus?.run?.id, deploymentStatus?.run?.status, runningPipelineKey, selectedPipeline?._id, selectedPipeline?.repository.branch, selectedPipeline?.repository.url]);

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
      setTestCommand(appType === 'serverless-api' ? 'echo "Skipping Lambda tests by default. Set a custom test command to run them."' : 'npm test -- --watch=false');
      setBuildCommand(appType === 'serverless-api' ? 'npm run build --if-present' : 'npm run build');
      setStartCommand(appType === 'static-spa' ? 'npm run preview -- --host 0.0.0.0' : 'npm start');
    }
  }, [appType]);

  useEffect(() => {
    if (selectedDeployment?.diagram?.activeRegion) {
      setTargetRegion(selectedDeployment.diagram.activeRegion);
    }
    if (appType === 'serverless-api') {
      const inferredLambdaName = lambdaFunctionNameFromDeployment(selectedDeployment);
      if (inferredLambdaName) setLambdaFunctionName(inferredLambdaName);
    }
  }, [appType, selectedDeployment]);

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
      const payload = {
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
        target: {
          region: targetRegion,
          lambdaFunctionName: appType === 'serverless-api' ? lambdaFunctionName : undefined,
        },
      };
      const pipeline = selectedPipeline
        ? await updateApplicationPipeline(selectedPipeline._id, payload)
        : await createApplicationPipeline(payload);
      await refreshPipelineData();
      setSelectedPipelineId(pipeline._id);
      setMessage(selectedPipeline ? 'Pipeline updated. Sync these files, then deploy with workflow dispatch.' : 'Pipeline generated. Sync these files, then deploy with workflow dispatch.');
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
      cacheGithubConnection(connection);
      if (!connection.connected) {
        setGithubRepos([]);
        cacheGithubRepositories([]);
        setGithubBranches([]);
        setSelectedGithubRepo('');
        setGithubOwner('');
        setGithubRepo('');
        return false;
      }

      try {
        const repos = await listGithubRepositories();
        setGithubRepos(repos);
        cacheGithubRepositories(repos);
        const preferredRepo = repos.find((repo) => repo.fullName === selectedGithubRepo) ?? repos[0];
        if (preferredRepo) chooseGithubRepository(preferredRepo.fullName, repos);
        if (repos.length === 0) {
          setMessage('GitHub connected, but no repositories were returned for this account or app permission.');
        }
      } catch (repoError) {
        if (!options.silent) setError(repoError instanceof Error ? repoError.message : 'GitHub is connected, but repositories could not be loaded.');
      }
      return true;
    } catch (githubError) {
      if (options.silent && readCachedGithubConnection().connected) return false;
      setGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
        cacheGithubRepositories([]);
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
    const popup = window.open(githubOAuthUrl({ mode: 'popup', returnTo: '/dashboard?view=infra-pipeline' }), 'infraflow-github-oauth', 'width=980,height=760');
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
      cacheGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
        cacheGithubRepositories([]);
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
    if (deployingApplicationRef.current) return;
    if (readRunningAppPipelineIds().includes(selectedPipeline._id)) {
      setError('Deployment is already running for this pipeline.');
      return;
    }
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
    markAppPipelineDeploymentRunning(selectedPipeline._id);
    deployingApplicationRef.current = true;
    setIsDeployingApplication(true);
    setActivePreviewTab('activity');
    try {
      const status = await deployApplicationPipeline(selectedPipeline._id, { owner: githubOwner, repo: githubRepo, branch });
      setDeploymentStatus(status);
      setMessage(status.message ?? 'Deployment workflow started.');
      window.dispatchEvent(new CustomEvent(liveDeploymentStartedEvent, { detail: { type: 'app', pipelineId: selectedPipeline._id } }));
      if (status.run?.status !== 'completed') {
        window.setTimeout(() => void refreshApplicationDeploymentStatus({ silent: true }), 2200);
      }
    } catch (deployError) {
      clearAppPipelineDeploymentRunning(selectedPipeline._id);
      setError(deployError instanceof Error ? deployError.message : 'Unable to start application deployment.');
    } finally {
      deployingApplicationRef.current = false;
      setIsDeployingApplication(false);
    }
  }

  async function refreshApplicationDeploymentStatus(options: { silent?: boolean } = {}) {
    const repository = selectedPipeline ? parseGithubRepositoryUrl(selectedPipeline.repository.url) : undefined;
    const owner = githubOwner || repository?.owner;
    const repo = githubRepo || repository?.repo;
    const selectedBranch = branch || selectedPipeline?.repository.branch || 'main';
    if (!selectedPipeline || !owner || !repo) return;
    if (!options.silent) {
      setMessage('');
      setError('');
    }
    setIsPollingDeployment(true);
    try {
      const status = await getApplicationDeploymentStatus(selectedPipeline._id, { owner, repo, branch: selectedBranch });
      setDeploymentStatus(status);
      if (status.run?.status === 'completed') clearAppPipelineDeploymentRunning(selectedPipeline._id);
      else if (status.run?.status && LIVE_APP_RUN_STATUSES.has(status.run.status)) markAppPipelineDeploymentRunning(selectedPipeline._id);
      setRunningPipelineIds(readRunningAppPipelineIds());
      if (!options.silent) setMessage('Deployment status refreshed.');
    } catch (statusError) {
      if (!options.silent) setError(statusError instanceof Error ? statusError.message : 'Unable to refresh deployment status.');
    } finally {
      setIsPollingDeployment(false);
    }
  }

  async function forceStopApplicationPipeline(pipeline: ApplicationPipelineRecord) {
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    setMessage('');
    setError('');
    setForceStoppingPipelineId(pipeline._id);
    try {
      const result = await forceStopApplicationDeployment(pipeline._id, {
        owner: repository?.owner,
        repo: repository?.repo,
        branch: pipeline.repository.branch || 'main',
      });
      clearAppPipelineDeploymentRunning(pipeline._id);
      setRunningPipelineIds(readRunningAppPipelineIds());
      if (selectedPipelineId === pipeline._id) setDeploymentStatus(undefined);
      setMessage(result.message || 'Pipeline deployment stopped.');
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to stop this deployment.');
    } finally {
      setForceStoppingPipelineId('');
    }
  }

  async function cancelQueuedApplicationPipelineRuns(pipeline: ApplicationPipelineRecord) {
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    setMessage('');
    setError('');
    setCancellingQueuedPipelineId(pipeline._id);
    try {
      const result = await cancelQueuedApplicationWorkflows(pipeline._id, {
        owner: repository?.owner,
        repo: repository?.repo,
        branch: pipeline.repository.branch || 'main',
      });
      setMessage(result.message);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel queued workflow runs.');
    } finally {
      setCancellingQueuedPipelineId('');
    }
  }

  function selectApplicationPipeline(pipeline: ApplicationPipelineRecord) {
    setSelectedPipelineId(pipeline._id);
    setSelectedFilePath('');
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    if (repository) {
      setGithubOwner(repository.owner);
      setGithubRepo(repository.repo);
      setBranch(pipeline.repository.branch || 'main');
    }
  }

  async function syncApplicationPipelineRow(pipeline: ApplicationPipelineRecord) {
    if (!githubConnection.connected) {
      setError('Connect GitHub before syncing generated files.');
      return;
    }
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    if (!repository) {
      setError('Pipeline repository is missing. Connect GitHub and regenerate this pipeline.');
      return;
    }
    setMessage('');
    setError('');
    setIsSyncingGithub(true);
    selectApplicationPipeline(pipeline);
    try {
      const result = await syncPipelineToGithub(pipeline._id, {
        owner: repository.owner,
        repo: repository.repo,
        branch: pipeline.repository.branch || 'main',
      });
      await refreshPipelineData();
      setSelectedPipelineId(result.pipeline._id);
      setMessage(`Synced ${result.sync.files.length} files to GitHub. Latest commit ${result.sync.commitSha.slice(0, 7)}.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync repository.');
    } finally {
      setIsSyncingGithub(false);
    }
  }

  async function deployApplicationPipelineRow(pipeline: ApplicationPipelineRecord) {
    if (deployingApplicationRef.current) return;
    if (readRunningAppPipelineIds().includes(pipeline._id)) {
      setError('Deployment is already running for this pipeline.');
      return;
    }
    if (!githubConnection.connected) {
      setError('Connect GitHub before deploying the application.');
      return;
    }
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    if (!repository) {
      setError('Pipeline repository is missing. Connect GitHub and regenerate this pipeline.');
      return;
    }
    setMessage('');
    setError('');
    markAppPipelineDeploymentRunning(pipeline._id);
    deployingApplicationRef.current = true;
    setIsDeployingApplication(true);
    selectApplicationPipeline(pipeline);
    try {
      const status = await deployApplicationPipeline(pipeline._id, {
        owner: repository.owner,
        repo: repository.repo,
        branch: pipeline.repository.branch || 'main',
      });
      setDeploymentStatus(status);
      setMessage(status.message ?? 'Deployment workflow started.');
      setIsDeploymentResultOpen(true);
      window.dispatchEvent(new CustomEvent(liveDeploymentStartedEvent, { detail: { type: 'app', pipelineId: pipeline._id } }));
    } catch (deployError) {
      clearAppPipelineDeploymentRunning(pipeline._id);
      setError(deployError instanceof Error ? deployError.message : 'Unable to start application deployment.');
    } finally {
      deployingApplicationRef.current = false;
      setIsDeployingApplication(false);
    }
  }

  async function showApplicationPipelineResourceHealth(pipeline: ApplicationPipelineRecord) {
    const deploymentId = pipelineDeploymentId(pipeline.deployment);
    if (!deploymentId) {
      setError('No infrastructure deployment is linked to this pipeline. Regenerate it with an infrastructure target to see resource health.');
      return;
    }
    setMessage('');
    setError('');
    setIsPollingDeployment(true);
    selectApplicationPipeline(pipeline);
    try {
      const deployment = await getDeployment(deploymentId);
      setResourceHealthDeployment(deployment);
      setResourceHealthPipelineName(pipeline.name);
    } catch (healthError) {
      setError(healthError instanceof Error ? healthError.message : 'Unable to load resource health for this pipeline.');
    } finally {
      setIsPollingDeployment(false);
    }
  }

  function togglePipelineSelection(pipelineId: string, checked: boolean) {
    setSelectedPipelineIds((current) => (checked ? Array.from(new Set([...current, pipelineId])) : current.filter((id) => id !== pipelineId)));
  }

  function toggleAllPipelineSelection(checked: boolean) {
    setSelectedPipelineIds(checked ? pipelines.map((pipeline) => pipeline._id) : []);
  }

  async function deleteApplicationPipelineRow(pipeline: ApplicationPipelineRecord) {
    setMessage('');
    setError('');
    setDeletingPipelineId(pipeline._id);
    try {
      await deleteApplicationPipeline(pipeline._id);
      setPipelines((records) => records.filter((record) => record._id !== pipeline._id));
      if (selectedPipelineId === pipeline._id) {
        setSelectedPipelineId('');
        setDeploymentStatus(undefined);
      }
      setPendingDeletePipeline(null);
      setMessage(`Deleted pipeline "${pipeline.name}".`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete pipeline.');
    } finally {
      setDeletingPipelineId('');
    }
  }

  async function deleteSelectedApplicationPipelines(records: ApplicationPipelineRecord[]) {
    if (!records.length) return;
    setMessage('');
    setError('');
    setDeletingPipelineId('bulk');
    try {
      await Promise.all(records.map((pipeline) => deleteApplicationPipeline(pipeline._id)));
      const deletedIds = new Set(records.map((pipeline) => pipeline._id));
      setPipelines((current) => current.filter((pipeline) => !deletedIds.has(pipeline._id)));
      setSelectedPipelineIds((current) => current.filter((id) => !deletedIds.has(id)));
      if (selectedPipelineId && deletedIds.has(selectedPipelineId)) {
        setSelectedPipelineId('');
        setDeploymentStatus(undefined);
      }
      setPendingBulkDeletePipelines([]);
      setMessage(`Deleted ${records.length} pipelines.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete selected pipelines.');
    } finally {
      setDeletingPipelineId('');
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
    <div className="dash-page dash-page--deployments dash-page--app-pipeline-inventory">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}

      <header className="pipeline-console-header">
        <div>
          <span className="dash-eyebrow">Infrastructure deployment pipeline</span>
          <h2>Infra Pipeline</h2>
        </div>
        <div className="pipeline-header-badges">
          <span className={`pipeline-badge ${githubConnection.connected ? 'pipeline-badge--success' : 'pipeline-badge--warning'}`}>
            <Github size={13} />
            {githubConnection.connected ? `@${githubConnection.login}` : 'GitHub not connected'}
          </span>
          {githubConnection.connected ? (
            <button className="pipeline-github-action pipeline-github-action--connected" onClick={() => void disconnectGithubAccount()} type="button">
              <Github size={14} />
              Disconnect GitHub
            </button>
          ) : (
            <div className="legal-connect-group legal-connect-group--compact">
              <p className="legal-inline-notice">
                By connecting GitHub, you authorize infraflow to sync files per our{' '}
                <a href="/legal/terms" rel="noreferrer" target="_blank">
                  Terms of Service
                </a>
                .
              </p>
              <button className="pipeline-github-action" disabled={isGithubLoading} onClick={connectGithub} type="button">
                <Github size={14} />
                {isGithubLoading ? 'Checking...' : 'Connect GitHub'}
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="deployment-summary">
        <div>
          <span>Total pipelines</span>
          <strong>{pipelines.length}</strong>
        </div>
        <div>
          <span>Synced to GitHub</span>
          <strong>{syncedPipelineCount}</strong>
        </div>
        <div>
          <span>Lambda pipelines</span>
          <strong>{lambdaPipelineCount}</strong>
        </div>
        <div>
          <span>AWS roles ready</span>
          <strong>{provisionedRoleCount}</strong>
        </div>
      </section>

      <Panel
        title="Application Pipelines"
        action={`${pipelines.length} pipelines`}
      >
        {pipelines.length > 0 && (
          <div className="pipeline-bulk-actions">
            <span>{selectedPipelineIds.length ? `${selectedPipelineIds.length} selected` : 'Select pipelines to delete multiple records'}</span>
            <button
              className="dash-secondary-action dash-danger-action"
              disabled={!selectedPipelineIds.length || Boolean(deletingPipelineId)}
              onClick={() => setPendingBulkDeletePipelines(selectedPipelines)}
              type="button"
            >
              <Trash2 size={15} />
              Delete selected
            </button>
          </div>
        )}
        <div className="dash-deploy-table-wrap">
          {pipelines.length ? (
            <table className="dash-deploy-table app-pipeline-inventory-table">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Select all pipelines"
                      checked={areAllPipelinesSelected}
                      type="checkbox"
                      onChange={(event) => toggleAllPipelineSelection(event.target.checked)}
                    />
                  </th>
                  <th>Pipeline</th>
                  <th>Target</th>
                  <th>Repository</th>
                  <th>Sync</th>
                  <th>AWS role</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map((pipeline) => {
                  const isPipelineDeploymentRunning = runningPipelineIds.includes(pipeline._id);
                  return (
                    <Fragment key={pipeline._id}>
                      <tr className="dash-deploy-table-row">
                        <td>
                          <input
                            aria-label={`Select ${pipeline.name}`}
                            checked={selectedPipelineIds.includes(pipeline._id)}
                            type="checkbox"
                            onChange={(event) => togglePipelineSelection(pipeline._id, event.target.checked)}
                          />
                        </td>
                        <td>
                          <button className="dash-deploy-name-button" onClick={() => selectApplicationPipeline(pipeline)} type="button">
                            <strong>{pipeline.name}</strong>
                            <span>{pipelineAppTypeLabel(pipeline.appType)} · {pipeline.environment}</span>
                          </button>
                        </td>
                        <td>
                          <span className="pipeline-badge">{pipeline.target.type}</span>
                          <div className="dash-deploy-elapsed">{pipeline.target.region || 'Region pending'}</div>
                        </td>
                        <td>
                          <strong>{githubRepositoryLabel(pipeline.repository.url)}</strong>
                          <div className="dash-deploy-elapsed">{pipeline.repository.branch || 'main'}</div>
                        </td>
                        <td>
                          {pipeline.repository.lastSyncedAt ? (
                            <span className="status-pill status-pill--running">{pipeline.repository.lastSyncCommit?.slice(0, 7) ?? 'Synced'}</span>
                          ) : (
                            <span className="status-pill status-pill--unknown">Pending</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill status-pill--${awsDeployRolePillVariant(pipeline.awsDeployRole?.status)}`}>
                            {awsDeployRoleLabel(pipeline.awsDeployRole?.status)}
                          </span>
                        </td>
                        <td>{pipeline.updatedAt ? new Date(pipeline.updatedAt).toLocaleString() : 'Pending'}</td>
                        <td>
                          <div className="dash-deploy-table-actions">
                            <button className="dash-secondary-action" disabled={isSyncingGithub} onClick={() => void syncApplicationPipelineRow(pipeline)} type="button">
                              <Github size={15} />
                              Sync
                            </button>
                            <button className="dash-secondary-action" disabled={isPollingDeployment} onClick={() => void showApplicationPipelineResourceHealth(pipeline)} type="button">
                              <Activity size={15} />
                              Performance
                            </button>
                            <button className="dash-secondary-action" disabled={isDeployingApplication || isPipelineDeploymentRunning} onClick={() => void deployApplicationPipelineRow(pipeline)} type="button">
                              <Rocket size={15} />
                              {isPipelineDeploymentRunning ? 'Running...' : 'Deploy'}
                            </button>
                            {isPipelineDeploymentRunning && (
                              <button
                                className="dash-secondary-action dash-danger-action"
                                disabled={forceStoppingPipelineId === pipeline._id}
                                onClick={() => void forceStopApplicationPipeline(pipeline)}
                                type="button"
                              >
                                <X size={15} />
                                {forceStoppingPipelineId === pipeline._id ? 'Stopping...' : 'Force stop'}
                              </button>
                            )}
                            <button
                              className="dash-secondary-action dash-danger-action"
                              disabled={cancellingQueuedPipelineId === pipeline._id}
                              onClick={() => void cancelQueuedApplicationPipelineRuns(pipeline)}
                              type="button"
                            >
                              <XCircle size={15} />
                              {cancellingQueuedPipelineId === pipeline._id ? 'Cancelling...' : 'Cancel queued'}
                            </button>
                            <button className="dash-secondary-action dash-danger-action" disabled={deletingPipelineId === pipeline._id} onClick={() => setPendingDeletePipeline(pipeline)} type="button">
                              <Trash2 size={15} />
                              {deletingPipelineId === pipeline._id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState>{isLoading ? 'Loading application pipelines...' : 'No application pipelines yet. Create one to deploy application code from GitHub.'}</EmptyState>
          )}
        </div>
      </Panel>
      {pendingBulkDeletePipelines.length > 0 && (
        <div
          className="pipeline-result-backdrop"
          role="presentation"
          onClick={() => {
            if (!deletingPipelineId) setPendingBulkDeletePipelines([]);
          }}
        >
          <section className="pipeline-result-modal pipeline-delete-modal" role="dialog" aria-modal="true" aria-label="Delete selected pipelines" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Delete selected pipelines</span>
                <h3>{pendingBulkDeletePipelines.length} pipelines selected</h3>
                <p>This removes selected pipeline records from InfraFlow. Files already synced to GitHub will not be deleted.</p>
              </div>
              <button
                className="pipeline-result-close"
                disabled={Boolean(deletingPipelineId)}
                onClick={() => setPendingBulkDeletePipelines([])}
                type="button"
                aria-label="Close bulk delete popup"
              >
                <X size={16} />
              </button>
            </header>
            <div className="pipeline-delete-modal__body">
              <AlertTriangle size={18} />
              <div>
                <strong>This will delete multiple pipeline records.</strong>
                <span>{pendingBulkDeletePipelines.map((pipeline) => pipeline.name).slice(0, 3).join(', ')}{pendingBulkDeletePipelines.length > 3 ? ` and ${pendingBulkDeletePipelines.length - 3} more` : ''}</span>
              </div>
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={Boolean(deletingPipelineId)} onClick={() => setPendingBulkDeletePipelines([])} type="button">
                Cancel
              </button>
              <button
                className="dash-secondary-action dash-danger-action"
                disabled={Boolean(deletingPipelineId)}
                onClick={() => void deleteSelectedApplicationPipelines(pendingBulkDeletePipelines)}
                type="button"
              >
                <Trash2 size={15} />
                {deletingPipelineId === 'bulk' ? 'Deleting...' : 'Delete selected'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {pendingDeletePipeline && (
        <div
          className="pipeline-result-backdrop"
          role="presentation"
          onClick={() => {
            if (!deletingPipelineId) setPendingDeletePipeline(null);
          }}
        >
          <section className="pipeline-result-modal pipeline-delete-modal" role="dialog" aria-modal="true" aria-label="Delete pipeline" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>Delete pipeline</span>
                <h3>{pendingDeletePipeline.name}</h3>
                <p>This removes the pipeline record from InfraFlow. Files already synced to GitHub will not be deleted.</p>
              </div>
              <button
                className="pipeline-result-close"
                disabled={Boolean(deletingPipelineId)}
                onClick={() => setPendingDeletePipeline(null)}
                type="button"
                aria-label="Close delete pipeline popup"
              >
                <X size={16} />
              </button>
            </header>
            <div className="pipeline-delete-modal__body">
              <AlertTriangle size={18} />
              <div>
                <strong>This action cannot be undone inside InfraFlow.</strong>
                <span>{githubRepositoryLabel(pendingDeletePipeline.repository.url)} · {pendingDeletePipeline.environment}</span>
              </div>
            </div>
            <footer>
              <button className="dash-secondary-action" disabled={Boolean(deletingPipelineId)} onClick={() => setPendingDeletePipeline(null)} type="button">
                Cancel
              </button>
              <button className="dash-secondary-action dash-danger-action" disabled={Boolean(deletingPipelineId)} onClick={() => void deleteApplicationPipelineRow(pendingDeletePipeline)} type="button">
                <Trash2 size={15} />
                {deletingPipelineId === pendingDeletePipeline._id ? 'Deleting...' : 'Delete pipeline'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {resourceHealthDeployment && (
        <div className="pipeline-result-backdrop" role="dialog" aria-modal="true" aria-label="Resource health">
          <section className="pipeline-result-modal pipeline-resource-health-modal">
            <header>
              <div>
                <span>Resource health</span>
                <h3>{resourceHealthDeployment.name}</h3>
                <p>{resourceHealthPipelineName} · {deploymentStatusLabel(resourceHealthDeployment.status)}</p>
              </div>
              <button className="pipeline-result-close" onClick={() => setResourceHealthDeployment(undefined)} type="button" aria-label="Close resource health">
                <X size={16} />
              </button>
            </header>
            {resourceHealthMetrics.length ? (
              <div className="dash-deploy-detail-table-wrap">
                <table className="dash-deploy-detail-table dash-deploy-live-table">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th>Service</th>
                      <th>Usage</th>
                      <th>Health</th>
                      <th>Month spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resourceHealthMetrics.map((metric) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="pipeline-muted">No created resources were captured for this pipeline's infrastructure deployment yet.</p>
            )}
            <footer>
              <button className="dash-primary-action" onClick={() => setResourceHealthDeployment(undefined)} type="button">
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
      {isDeploymentResultOpen && deploymentStatus && (deploymentStatus.run || deploymentStatus.statusUnavailable) && (
        <div className="pipeline-result-backdrop" role="dialog" aria-modal="true" aria-label="Deployment result">
          <section className={`pipeline-result-modal pipeline-result-modal--${applicationRunResultTone(deploymentStatus)}`}>
            <header>
              <div>
                <span>
                  {applicationRunResultTitle(deploymentStatus)}
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
                <strong>{applicationDispatchModeLabel(deploymentStatus.dispatchMode)}</strong>
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


function ApplicationPipelinePage() {
  const user = getStoredUser();
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [pipelines, setPipelines] = useState<ApplicationPipelineRecord[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [name, setName] = useState('Production application pipeline');
  const [appType, setAppType] = useState('react-app');
  const [environment, setEnvironment] = useState<'development' | 'test' | 'staging' | 'production'>('development');
  const [branch, setBranch] = useState('main');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubConnection, setGithubConnection] = useState<GithubConnection>(readCachedGithubConnection);
  const [githubRepos, setGithubRepos] = useState<GithubRepository[]>(readCachedGithubRepositories);
  const [githubBranches, setGithubBranches] = useState<GithubBranch[]>([]);
  const [selectedGithubRepo, setSelectedGithubRepo] = useState('');
  const [installCommand, setInstallCommand] = useState('npm ci');
  const [testCommand, setTestCommand] = useState('npm test -- --watch=false');
  const [buildCommand, setBuildCommand] = useState('npm run build');
  const [startCommand, setStartCommand] = useState('npm start');
  const [targetRegion, setTargetRegion] = useState('ap-south-1');
  const [lambdaFunctionName, setLambdaFunctionName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGithubBranchesLoading, setIsGithubBranchesLoading] = useState(false);
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);
  const [githubAccess, setGithubAccess] = useState<GithubRepositoryAccess>();
  const [isCheckingGithubAccess, setIsCheckingGithubAccess] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<'overview' | 'workflow' | 'files' | 'activity'>('overview');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<ApplicationDeploymentStatus>();
  const [isDeployingApplication, setIsDeployingApplication] = useState(false);
  const deployingApplicationRef = useRef(false);
  const [runningPipelineIds, setRunningPipelineIds] = useState<string[]>(readRunningAppPipelineIds);
  const runningPipelineKey = runningPipelineIds.join('|');
  const [forceStoppingPipelineId, setForceStoppingPipelineId] = useState('');
  const [cancellingQueuedPipelineId, setCancellingQueuedPipelineId] = useState('');
  const [isPollingDeployment, setIsPollingDeployment] = useState(false);
  const [deploymentResultRunId, setDeploymentResultRunId] = useState<number>();
  const [isDeploymentResultOpen, setIsDeploymentResultOpen] = useState(false);
  const githubPopupRef = useRef<Window | null>(null);
  const githubPollRef = useRef<number | undefined>(undefined);
  const selectedPipeline = pipelines.find((pipeline) => pipeline._id === selectedPipelineId) ?? pipelines[0];
  const isSelectedPipelineDeploymentRunning = selectedPipeline ? runningPipelineIds.includes(selectedPipeline._id) : false;
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
      const pipelineData = await listApplicationPipelines();
      setPipelines(pipelineData);
      setSelectedPipelineId((current) => current || pipelineData[0]?._id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load pipeline data.');
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshDeploymentOptions() {
    if (deployments.length || isLoading) return;
    try {
      const records = await listDeployments();
      setDeployments(records);
      setSelectedDeploymentId((current) => current || records.find((deployment) => deployment.status === 'deployed')?._id || records[0]?._id || '');
    } catch {
      // Deployment targets are optional for application pipelines; do not surface this during navigation.
    }
  }

  useEffect(() => {
    void refreshPipelineData();
    void refreshGithubConnection({ silent: true });

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
    function handleGithubConnectionCache(event: Event) {
      const nextConnection = (event as CustomEvent<GithubConnection>).detail;
      if (nextConnection) setGithubConnection(nextConnection);
    }

    window.addEventListener('infraflow:github-connection-cache', handleGithubConnectionCache);
    return () => window.removeEventListener('infraflow:github-connection-cache', handleGithubConnectionCache);
  }, []);
  useEffect(() => {
    function handleRunningPipelinesChanged() {
      setRunningPipelineIds(readRunningAppPipelineIds());
    }

    window.addEventListener(appPipelineDeploymentRunningEvent, handleRunningPipelinesChanged);
    return () => window.removeEventListener(appPipelineDeploymentRunningEvent, handleRunningPipelinesChanged);
  }, []);

  useEffect(() => {
    if (!selectedPipeline || !runningPipelineIds.includes(selectedPipeline._id)) return;
    if (deploymentStatus?.run && deploymentStatus.run.status !== 'completed') return;

    const repository = parseGithubRepositoryUrl(selectedPipeline.repository.url);
    if (!repository) return;

    setGithubOwner(repository.owner);
    setGithubRepo(repository.repo);
    setBranch(selectedPipeline.repository.branch || 'main');
    setActivePreviewTab('activity');

    let isCurrent = true;
    setIsPollingDeployment(true);
    void getApplicationDeploymentStatus(selectedPipeline._id, {
      owner: repository.owner,
      repo: repository.repo,
      branch: selectedPipeline.repository.branch || 'main',
    })
      .then((status) => {
        if (!isCurrent) return;
        setDeploymentStatus(status);
        if (status.run?.status === 'completed') clearAppPipelineDeploymentRunning(selectedPipeline._id);
        else if (status.run?.status && LIVE_APP_RUN_STATUSES.has(status.run.status)) markAppPipelineDeploymentRunning(selectedPipeline._id);
        setRunningPipelineIds(readRunningAppPipelineIds());
      })
      .catch(() => {
        if (isCurrent) setRunningPipelineIds(readRunningAppPipelineIds());
      })
      .finally(() => {
        if (isCurrent) setIsPollingDeployment(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [deploymentStatus?.run?.id, deploymentStatus?.run?.status, runningPipelineKey, selectedPipeline?._id, selectedPipeline?.repository.branch, selectedPipeline?.repository.url]);

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
      setTestCommand(appType === 'serverless-api' ? 'echo "Skipping Lambda tests by default. Set a custom test command to run them."' : 'npm test -- --watch=false');
      setBuildCommand(appType === 'serverless-api' ? 'npm run build --if-present' : 'npm run build');
      setStartCommand(appType === 'static-spa' ? 'npm run preview -- --host 0.0.0.0' : 'npm start');
    }
  }, [appType]);

  useEffect(() => {
    if (selectedDeployment?.diagram?.activeRegion) {
      setTargetRegion(selectedDeployment.diagram.activeRegion);
    }
    if (appType === 'serverless-api') {
      const inferredLambdaName = lambdaFunctionNameFromDeployment(selectedDeployment);
      if (inferredLambdaName) setLambdaFunctionName(inferredLambdaName);
    }
  }, [appType, selectedDeployment]);

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
    if (!selectedPipeline) return;
    const repository = parseGithubRepositoryUrl(selectedPipeline.repository.url);
    if (!repository) return;
    const fullName = `${repository.owner}/${repository.repo}`;
    setSelectedGithubRepo(fullName);
    setGithubOwner(repository.owner);
    setGithubRepo(repository.repo);
    setBranch(selectedPipeline.repository.branch || 'main');
    if (githubConnection.connected) {
      void syncGithubBranches(repository.owner, repository.repo, selectedPipeline.repository.branch || 'main');
    }
  }, [githubConnection.connected, selectedPipeline?._id, selectedPipeline?.repository.branch, selectedPipeline?.repository.url]);

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
      const payload = {
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
        target: {
          region: targetRegion,
          lambdaFunctionName: appType === 'serverless-api' ? lambdaFunctionName : undefined,
        },
      };
      const pipeline = selectedPipeline
        ? await updateApplicationPipeline(selectedPipeline._id, payload)
        : await createApplicationPipeline(payload);
      await refreshPipelineData();
      setSelectedPipelineId(pipeline._id);
      setMessage(selectedPipeline ? 'Pipeline updated. Sync these files, then deploy with workflow dispatch.' : 'Pipeline generated. Sync these files, then deploy with workflow dispatch.');
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

  async function verifyGithubAccess(options: { silent?: boolean } = {}) {
    if (!githubOwner || !githubRepo) {
      if (!options.silent) setError('Choose a GitHub repository before checking access.');
      return false;
    }

    setIsCheckingGithubAccess(true);
    try {
      const access = await checkGithubRepositoryAccess(githubOwner, githubRepo, selectedPipeline?.repository.workflowPath);
      setGithubAccess(access);
      if (!access.ok && !options.silent) setError(access.message);
      return access.ok;
    } catch (accessError) {
      const message = accessError instanceof Error ? accessError.message : 'Unable to check GitHub repository access.';
      if (!options.silent) setError(message);
      setGithubAccess(undefined);
      return false;
    } finally {
      setIsCheckingGithubAccess(false);
    }
  }

  async function refreshGithubConnection(options: { silent?: boolean } = {}) {
    if (!options.silent) setIsGithubLoading(true);
    try {
      const connection = await getGithubStatus();
      setGithubConnection(connection);
      cacheGithubConnection(connection);
      if (!connection.connected) {
        setGithubRepos([]);
        cacheGithubRepositories([]);
        setGithubBranches([]);
        setSelectedGithubRepo('');
        setGithubOwner('');
        setGithubRepo('');
        return false;
      }

      try {
        const repos = await listGithubRepositories();
        setGithubRepos(repos);
        cacheGithubRepositories(repos);
        const preferredRepo = repos.find((repo) => repo.fullName === selectedGithubRepo) ?? repos[0];
        if (preferredRepo) chooseGithubRepository(preferredRepo.fullName, repos);
        if (repos.length === 0) {
          setMessage('GitHub connected, but no repositories were returned for this account or app permission.');
        }
      } catch (repoError) {
        if (!options.silent) setError(repoError instanceof Error ? repoError.message : 'GitHub is connected, but repositories could not be loaded.');
      }
      return true;
    } catch (githubError) {
      if (options.silent && readCachedGithubConnection().connected) return false;
      setGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
        cacheGithubRepositories([]);
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
      cacheGithubConnection({ connected: false, login: '', scopes: [] });
      setGithubRepos([]);
        cacheGithubRepositories([]);
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
      const hasAccess = await verifyGithubAccess();
      if (!hasAccess) return;
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
    if (deployingApplicationRef.current) return;
    if (readRunningAppPipelineIds().includes(selectedPipeline._id)) {
      setError('Deployment is already running for this pipeline.');
      return;
    }
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
    const hasAccess = await verifyGithubAccess();
    if (!hasAccess) return;
    markAppPipelineDeploymentRunning(selectedPipeline._id);
    deployingApplicationRef.current = true;
    setIsDeployingApplication(true);
    setActivePreviewTab('activity');
    try {
      const status = await deployApplicationPipeline(selectedPipeline._id, { owner: githubOwner, repo: githubRepo, branch });
      setDeploymentStatus(status);
      setMessage(status.message ?? 'Deployment workflow started.');
      window.dispatchEvent(new CustomEvent(liveDeploymentStartedEvent, { detail: { type: 'app', pipelineId: selectedPipeline._id } }));
      if (status.run?.status !== 'completed') {
        window.setTimeout(() => void refreshApplicationDeploymentStatus({ silent: true }), 2200);
      }
    } catch (deployError) {
      clearAppPipelineDeploymentRunning(selectedPipeline._id);
      setError(deployError instanceof Error ? deployError.message : 'Unable to start application deployment.');
    } finally {
      deployingApplicationRef.current = false;
      setIsDeployingApplication(false);
    }
  }

  async function refreshApplicationDeploymentStatus(options: { silent?: boolean } = {}) {
    const repository = selectedPipeline ? parseGithubRepositoryUrl(selectedPipeline.repository.url) : undefined;
    const owner = githubOwner || repository?.owner;
    const repo = githubRepo || repository?.repo;
    const selectedBranch = branch || selectedPipeline?.repository.branch || 'main';
    if (!selectedPipeline || !owner || !repo) return;
    if (!options.silent) {
      setMessage('');
      setError('');
    }
    setIsPollingDeployment(true);
    try {
      const status = await getApplicationDeploymentStatus(selectedPipeline._id, { owner, repo, branch: selectedBranch });
      setDeploymentStatus(status);
      if (status.run?.status === 'completed') clearAppPipelineDeploymentRunning(selectedPipeline._id);
      else if (status.run?.status && LIVE_APP_RUN_STATUSES.has(status.run.status)) markAppPipelineDeploymentRunning(selectedPipeline._id);
      setRunningPipelineIds(readRunningAppPipelineIds());
      if (!options.silent) setMessage('Deployment status refreshed.');
    } catch (statusError) {
      if (!options.silent) setError(statusError instanceof Error ? statusError.message : 'Unable to refresh deployment status.');
    } finally {
      setIsPollingDeployment(false);
    }
  }

  async function forceStopApplicationPipeline(pipeline: ApplicationPipelineRecord) {
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    setMessage('');
    setError('');
    setForceStoppingPipelineId(pipeline._id);
    try {
      const result = await forceStopApplicationDeployment(pipeline._id, {
        owner: repository?.owner,
        repo: repository?.repo,
        branch: pipeline.repository.branch || 'main',
      });
      clearAppPipelineDeploymentRunning(pipeline._id);
      setRunningPipelineIds(readRunningAppPipelineIds());
      if (selectedPipelineId === pipeline._id) setDeploymentStatus(undefined);
      setMessage(result.message || 'Pipeline deployment stopped.');
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'Unable to stop this deployment.');
    } finally {
      setForceStoppingPipelineId('');
    }
  }

  async function cancelQueuedApplicationPipelineRuns(pipeline: ApplicationPipelineRecord) {
    const repository = parseGithubRepositoryUrl(pipeline.repository.url);
    setMessage('');
    setError('');
    setCancellingQueuedPipelineId(pipeline._id);
    try {
      const result = await cancelQueuedApplicationWorkflows(pipeline._id, {
        owner: repository?.owner,
        repo: repository?.repo,
        branch: pipeline.repository.branch || 'main',
      });
      setMessage(result.message);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel queued workflow runs.');
    } finally {
      setCancellingQueuedPipelineId('');
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
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
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
                  <option value="test">Test</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label className="pipeline-field pipeline-field--wide">
                <span>Infrastructure target</span>
                <select
                  value={selectedDeploymentId}
                  onChange={(event) => setSelectedDeploymentId(event.target.value)}
                  onFocus={() => void refreshDeploymentOptions()}
                  onPointerDown={() => void refreshDeploymentOptions()}
                >
                  <option value="">Auto detect from app type</option>
                  {deployments.map((deployment) => (
                    <option key={deployment._id} value={deployment._id}>
                      {deployment.name} ({deployment.status})
                    </option>
                  ))}
                </select>
              </label>
              {appType === 'serverless-api' && (
                <>
                  <label className="pipeline-field">
                    <span>AWS region</span>
                    <input value={targetRegion} onChange={(event) => setTargetRegion(event.target.value)} placeholder="ap-south-1" />
                  </label>
                  <label className="pipeline-field">
                    <span>Lambda function</span>
                    <input value={lambdaFunctionName} onChange={(event) => setLambdaFunctionName(event.target.value)} placeholder="my-existing-lambda" />
                  </label>
                </>
              )}
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
                <div className="legal-connect-group legal-connect-group--compact">
                  <p className="legal-inline-notice">
                    By connecting GitHub, you authorize infraflow to sync files per our{' '}
                    <a href="/legal/terms" rel="noreferrer" target="_blank">
                      Terms of Service
                    </a>
                    .
                  </p>
                  <button className="pipeline-primary-compact" onClick={connectGithub} type="button">
                    <Github size={14} />
                    Connect GitHub
                  </button>
                </div>
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
                  disabled={!githubConnection.connected || isGithubLoading || (!githubRepos.length && !selectedGithubRepo)}
                  value={selectedGithubRepo}
                  onChange={(event) => chooseGithubRepository(event.target.value)}
                >
                  <option value="">{isGithubLoading ? 'Loading repositories...' : 'Choose repository'}</option>
                  {selectedGithubRepo && !githubRepos.some((repo) => repo.fullName === selectedGithubRepo) && (
                    <option value={selectedGithubRepo}>{selectedGithubRepo} (saved)</option>
                  )}
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
            {githubConnection.connected && githubOwner && githubRepo && (
              <div className={githubAccess?.ok ? 'pipeline-inline-success' : 'pipeline-inline-warning'}>
                {githubAccess?.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>
                  {githubAccess
                    ? githubAccess.message
                    : 'Check GitHub access before syncing or deploying.'}
                </span>
                <button disabled={isCheckingGithubAccess} onClick={() => void verifyGithubAccess()} type="button">
                  {isCheckingGithubAccess ? 'Checking...' : 'Check access'}
                </button>
              </div>
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
                            {applicationDispatchModeLabel(deploymentStatus.dispatchMode)}
                          </em>
                        )}
                        <button className="pipeline-link-button" disabled={!selectedPipeline || !githubOwner || !githubRepo || isPollingDeployment} onClick={() => void refreshApplicationDeploymentStatus()} type="button">
                          <RefreshCw size={14} />
                          {isPollingDeployment ? 'Refreshing' : 'Refresh'}
                        </button>
                        {selectedPipeline && isSelectedPipelineDeploymentRunning && (
                          <button
                            className="pipeline-link-button pipeline-link-button--danger"
                            disabled={forceStoppingPipelineId === selectedPipeline._id}
                            onClick={() => void forceStopApplicationPipeline(selectedPipeline)}
                            type="button"
                          >
                            <X size={14} />
                            {forceStoppingPipelineId === selectedPipeline._id ? 'Stopping' : 'Force stop'}
                          </button>
                        )}
                        {selectedPipeline && (
                          <button
                            className="pipeline-link-button pipeline-link-button--danger"
                            disabled={cancellingQueuedPipelineId === selectedPipeline._id}
                            onClick={() => void cancelQueuedApplicationPipelineRuns(selectedPipeline)}
                            type="button"
                          >
                            <XCircle size={14} />
                            {cancellingQueuedPipelineId === selectedPipeline._id ? 'Cancelling' : 'Cancel queued'}
                          </button>
                        )}
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
            disabled={!selectedPipeline || !githubConnection.connected || !githubOwner || !githubRepo || isSyncingGithub || isCheckingGithubAccess}
            onClick={() => void syncSelectedPipeline()}
            type="button"
          >
            <Github size={15} />
            {isSyncingGithub ? 'Syncing...' : isCheckingGithubAccess ? 'Checking access...' : 'Sync to GitHub'}
          </button>
          <button
            className="dash-primary-action"
            disabled={!selectedPipeline || hasValidationErrors || isDeployingApplication || isSelectedPipelineDeploymentRunning || isCheckingGithubAccess}
            onClick={() => void deploySelectedApplication()}
            type="button"
          >
            <Rocket size={15} />
            {isSelectedPipelineDeploymentRunning ? 'Deployment running...' : isDeployingApplication ? 'Starting deployment...' : 'Deploy Application'}
          </button>
          {selectedPipeline && isSelectedPipelineDeploymentRunning && (
            <button
              className="dash-secondary-action dash-danger-action"
              disabled={forceStoppingPipelineId === selectedPipeline._id}
              onClick={() => void forceStopApplicationPipeline(selectedPipeline)}
              type="button"
            >
              <X size={15} />
              {forceStoppingPipelineId === selectedPipeline._id ? 'Stopping...' : 'Force stop'}
            </button>
          )}
          {selectedPipeline && (
            <button
              className="dash-secondary-action dash-danger-action"
              disabled={cancellingQueuedPipelineId === selectedPipeline._id}
              onClick={() => void cancelQueuedApplicationPipelineRuns(selectedPipeline)}
              type="button"
            >
              <XCircle size={15} />
              {cancellingQueuedPipelineId === selectedPipeline._id ? 'Cancelling...' : 'Cancel queued'}
            </button>
          )}
        </div>
      </footer>

      {isDeploymentResultOpen && deploymentStatus && (deploymentStatus.run || deploymentStatus.statusUnavailable) && (
        <div className="pipeline-result-backdrop" role="dialog" aria-modal="true" aria-label="Deployment result">
          <section className={`pipeline-result-modal pipeline-result-modal--${applicationRunResultTone(deploymentStatus)}`}>
            <header>
              <div>
                <span>
                  {applicationRunResultTitle(deploymentStatus)}
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
                <strong>{applicationDispatchModeLabel(deploymentStatus.dispatchMode)}</strong>
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

function lambdaFunctionNameFromDeployment(deployment?: DeploymentRecord): string {
  const outputValues = deployment?.outputs && typeof deployment.outputs === 'object' ? Object.values(deployment.outputs) : [];
  for (const output of outputValues) {
    if (!output || typeof output !== 'object') continue;
    const record = output as Record<string, unknown>;
    if (String(record.service ?? '').toLowerCase() === 'lambda' && record.function_name) {
      return String(record.function_name);
    }
  }

  const lambdaNode = deployment?.diagram?.nodes?.find((node) => node.data?.serviceId === 'lambda');
  return String(lambdaNode?.data?.config?.function_name ?? '').trim();
}

function parseGithubRepositoryUrl(url?: string): { owner: string; repo: string } | undefined {
  const match = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function githubRepositoryLabel(url?: string) {
  const parsed = parseGithubRepositoryUrl(url);
  return parsed ? `${parsed.owner}/${parsed.repo}` : 'Not linked';
}

function applicationDispatchModeLabel(mode?: ApplicationDeploymentStatus['dispatchMode']) {
  return mode === 'push_trigger' ? 'Push trigger' : 'Workflow dispatch';
}

function applicationRunResultTone(status: ApplicationDeploymentStatus) {
  if (status.statusUnavailable) return 'warning';
  if (status.run?.status !== 'completed') return 'in_progress';
  return status.run?.conclusion ?? 'completed';
}

function applicationRunResultTitle(status: ApplicationDeploymentStatus) {
  if (status.statusUnavailable) return 'Deployment triggered';
  if (status.run?.status !== 'completed') return 'Deployment in progress';
  if (status.run?.conclusion === 'success') return 'Deployment succeeded';
  if (status.run?.conclusion === 'cancelled') return 'Deployment cancelled';
  return 'Deployment failed';
}

function pipelineDeploymentId(deployment?: ApplicationPipelineRecord['deployment']) {
  if (!deployment) return '';
  return typeof deployment === 'string' ? deployment : deployment._id ?? '';
}

function pipelineAppTypeLabel(appType: string) {
  return pipelineAppTypes.find((item) => item.id === appType)?.label ?? appType;
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
      detail: pipeline.repository.lastSyncCommit ? `Ready from commit ${pipeline.repository.lastSyncCommit.slice(0, 7)}` : 'Run workflow dispatch after sync',
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
        : deploymentStatus?.run?.status === 'completed'
          ? 'success'
          : deploymentStatus?.run
            ? 'warning'
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
  const totalSpend = insights ? insights.billing.monthlySpend || insights.billing.byService.reduce((sum, item) => sum + item.cost, 0) || 0 : 0;

  return resources.map((resource) => {
    const inventory = insights ? findInsightInventory(resource.service, insights) : undefined;
    const spend = insights ? inventory?.spend ?? findServiceSpend(resource.service, insights) : 0;
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

function deploymentDriftStatusLabel(status: NonNullable<DeploymentRecord['drift']>['status']) {
  if (status === 'in_sync') return 'AWS in sync';
  if (status === 'drifted') return 'AWS drift';
  if (status === 'error') return 'Drift check failed';
  return 'Drift unknown';
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

type DeploymentLogEntry = DeploymentRecord['logs'][number];

type DestroyAttempt = {
  key: string;
  kind: 'destroy' | 'force-destroy' | 'auto-destroy';
  label: string;
  startedAt?: string;
  outcome: 'succeeded' | 'failed' | 'in-progress';
  failureReason?: string;
  entries: DeploymentLogEntry[];
};

// terraformDeploymentRunner.js pushes one of these exact messages as the very first log line of any
// destroy run (plain, force, or auto-triggered after a failed deploy) — they're the only reliable
// boundary markers available for splitting one deployment's flat, chronological log array back into
// separate destroy attempts. Deploy/update start messages are tracked too, only so their log lines
// don't get misattributed to whichever destroy attempt happens to precede them.
const DESTROY_ATTEMPT_START_MARKERS: Record<string, { kind: DestroyAttempt['kind']; label: string }> = {
  'Starting Terraform destroy runner.': { kind: 'destroy', label: 'Destroy' },
  'Force destroy requested by user. Proceeding even though the deployment may still be running elsewhere; Terraform state locking will safely reject this run if that is the case.': {
    kind: 'force-destroy',
    label: 'Force destroy',
  },
  'Automatically destroying AWS resources created before this deployment failed.': {
    kind: 'auto-destroy',
    label: 'Automatic cleanup after failed deploy',
  },
};

const DEPLOY_ATTEMPT_START_MARKERS = new Set(['Starting Terraform deployment runner.', 'Starting Terraform update runner.']);

function extractDestroyAttempts(logs: DeploymentLogEntry[]): DestroyAttempt[] {
  const attempts: DestroyAttempt[] = [];
  let current: DestroyAttempt | null = null;

  logs.forEach((entry, index) => {
    const marker = DESTROY_ATTEMPT_START_MARKERS[entry.message];
    if (marker) {
      current = { key: `${index}-${entry.message}`, kind: marker.kind, label: marker.label, startedAt: entry.at, outcome: 'in-progress', entries: [] };
      attempts.push(current);
    } else if (DEPLOY_ATTEMPT_START_MARKERS.has(entry.message)) {
      current = null;
    }

    current?.entries.push(entry);
  });

  // The runner always pushes its true failure/success message as the LAST line of a finished
  // attempt (via failDeployment on failure, or an explicit "destroy completed" info line on
  // success) — reading only the last entry avoids misreading an unrelated raw Terraform output line
  // that merely contains the word "error" as the actual failure reason.
  for (const attempt of attempts) {
    const last = attempt.entries[attempt.entries.length - 1];
    if (last?.level === 'error') {
      attempt.outcome = 'failed';
      attempt.failureReason = last.message;
    } else if (attempt.entries.some((entry) => /destroy completed|cleanup completed/i.test(entry.message))) {
      attempt.outcome = 'succeeded';
    }
  }

  return attempts.reverse();
}

function resourceVerificationStatusLabel(status: ResourceVerificationResult['resources'][number]['status']) {
  if (status === 'present') return 'Still in AWS';
  if (status === 'missing') return 'Confirmed removed';
  if (status === 'destroyed') return 'Not tracked (already destroyed)';
  return 'Unknown — verify manually';
}

function DestroyHistoryModal({ deployment, onClose }: { deployment: DeploymentRecord; onClose: () => void }) {
  const attempts = extractDestroyAttempts(deployment.logs);
  const [openAttemptKey, setOpenAttemptKey] = useState<string | undefined>(attempts[0]?.key);
  const [verification, setVerification] = useState<ResourceVerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  async function handleVerify() {
    setIsVerifying(true);
    setVerifyError('');
    try {
      setVerification(await verifyDeploymentResources(deployment._id));
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : 'Unable to check AWS right now.');
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="dash-destroy-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="dash-destroy-history-title"
        aria-modal="true"
        className="dash-destroy-history-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="dash-eyebrow">Destroy history</span>
            <h2 id="dash-destroy-history-title">{deployment.name}</h2>
          </div>
          <button aria-label="Close destroy history" className="dash-icon-button" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="dash-verify-resources">
          <div className="dash-verify-resources__intro">
            <div>
              <strong>Still in AWS, or cleaned up?</strong>
              <span>Checks live AWS state directly &mdash; separate from what Terraform's local record says.</span>
            </div>
            <button className="dash-secondary-action" disabled={isVerifying} onClick={() => void handleVerify()} type="button">
              <ShieldCheck size={15} />
              {isVerifying ? 'Checking AWS...' : 'Verify resources in AWS'}
            </button>
          </div>

          {verifyError && <PageAlert message={verifyError} tone="error" onDismiss={() => setVerifyError('')} />}

          {verification && (
            <div className="dash-verify-resources__results">
              {verification.error && (
                <div className="dash-verify-resources__warning">
                  <AlertTriangle size={14} />
                  <p>{verification.error}</p>
                </div>
              )}
              <span className="dash-verify-resources__checked-at">Checked {new Date(verification.checkedAt).toLocaleString()} &middot; {verification.region}</span>
              {verification.resources.length ? (
                <ul className="dash-verify-resources__list">
                  {verification.resources.map((resource) => (
                    <li className={`dash-verify-resource dash-verify-resource--${resource.status}`} key={resource.name}>
                      <div>
                        <strong>{resource.label}</strong>
                        <span>{resource.service || resource.terraformAddress}</span>
                      </div>
                      <div className="dash-verify-resource__status-group">
                        <em className={`dash-verify-status-pill dash-verify-status-pill--${resource.status}`}>{resourceVerificationStatusLabel(resource.status)}</em>
                        {resource.status !== 'destroyed' && (
                          <a className="dash-verify-resource__link" href={resource.consoleUrl} rel="noreferrer" target="_blank">
                            <ExternalLink size={12} />
                            Verify in AWS Console
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-verify-resources__empty">No tracked resource outputs were saved for this deployment to check.</p>
              )}
            </div>
          )}
        </div>

        <div className="dash-destroy-history-list">
          {attempts.map((attempt, index) => {
            const isOpen = openAttemptKey === attempt.key;
            return (
              <div className={`dash-destroy-attempt dash-destroy-attempt--${attempt.outcome}`} key={attempt.key}>
                <button className="dash-destroy-attempt__head" onClick={() => setOpenAttemptKey(isOpen ? undefined : attempt.key)} type="button">
                  <div>
                    <strong>
                      Attempt {attempts.length - index} &middot; {attempt.label}
                    </strong>
                    <span>{attempt.startedAt ? new Date(attempt.startedAt).toLocaleString() : 'Time not recorded'}</span>
                  </div>
                  <em className={`dash-deploy-log-pill dash-deploy-log--${attempt.outcome === 'failed' ? 'error' : attempt.outcome === 'succeeded' ? 'info' : 'warning'}`}>
                    {attempt.outcome === 'failed' ? 'Failed' : attempt.outcome === 'succeeded' ? 'Succeeded' : 'In progress'}
                  </em>
                </button>
                {attempt.failureReason && (
                  <div className="dash-destroy-attempt__reason">
                    <AlertTriangle size={14} />
                    <p>{attempt.failureReason}</p>
                  </div>
                )}
                {isOpen && (
                  <div className="dash-destroy-attempt__log">
                    {attempt.entries.map((entry, entryIndex) => (
                      <div className={`dash-destroy-log-line dash-destroy-log-line--${deploymentLogLevel(entry.level, entry.message)}`} key={`${attempt.key}-${entryIndex}`}>
                        <span>{entry.at ? new Date(entry.at).toLocaleTimeString() : ''}</span>
                        <p>{entry.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
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

function getFindingFix(finding: unknown) {
  if (finding && typeof finding === 'object' && 'fix' in finding) {
    const fix = (finding as { fix?: unknown }).fix;
    if (typeof fix === 'string' && fix.trim()) {
      return fix;
    }
  }

  return 'Review this AWS finding in the source service console.';
}

function hasGithubWorkflowScope(connection: GithubConnection) {
  if (connection.reconnectRequired) return false;
  if (connection.missingScopes?.length) return false;
  if (connection.requiredScopes?.length) {
    return connection.requiredScopes.every((scope) => connection.scopes?.includes(scope));
  }
  return Boolean(connection.scopes?.includes('workflow'));
}

function findMainScrollTarget(): HTMLElement | Window | null {
  const doc = document.documentElement;
  if (doc.scrollHeight - window.innerHeight > 16) {
    return window;
  }

  const content = document.querySelector('.dash-content');
  if (!content) return null;

  const candidates = content.querySelectorAll<HTMLElement>('*');
  for (const el of candidates) {
    if (el.scrollHeight - el.clientHeight <= 16) continue;
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return el;
    }
  }

  return null;
}

function useScrollHint(deps: React.DependencyList = []) {
  const [showScrollHint, setShowScrollHint] = useState(false);

  useEffect(() => {
    let target: HTMLElement | Window | null = null;
    let resizeObserver: ResizeObserver | null = null;

    function evaluate() {
      if (target === window) {
        const doc = document.documentElement;
        setShowScrollHint(doc.scrollHeight - window.innerHeight - window.scrollY > 16);
      } else if (target instanceof HTMLElement) {
        setShowScrollHint(target.scrollHeight - target.clientHeight - target.scrollTop > 16);
      } else {
        setShowScrollHint(false);
      }
    }

    target = findMainScrollTarget();
    evaluate();

    target?.addEventListener('scroll', evaluate, { passive: true });
    window.addEventListener('resize', evaluate);
    resizeObserver = new ResizeObserver(evaluate);
    resizeObserver.observe(target instanceof HTMLElement ? target : document.documentElement);

    return () => {
      target?.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
      resizeObserver?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { showScrollHint };
}

function ScrollHintIcon() {
  return (
    <div className="dash-scroll-hint" aria-hidden="true">
      <span className="dash-scroll-hint__tooltip">Scroll up / down</span>
      <span className="dash-scroll-hint__track">
        <span className="dash-scroll-hint__thumb" />
      </span>
    </div>
  );
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








