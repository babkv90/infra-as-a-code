import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  ArrowRight,
  AlertTriangle,
  BadgeDollarSign,
  Bell,
  CheckCircle2,
  CloudCog,
  Copy,
  ExternalLink,
  FilePlus2,
  Github,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  Upload,
} from 'lucide-react';
import { useReactFlow } from 'reactflow';
import Canvas from '../components/Canvas';
import DeploymentModal from '../components/DeploymentModal';
import PropertiesPanel from '../components/PropertiesPanel';
import Sidebar from '../components/Sidebar';
import StatusBar from '../components/StatusBar';
import Toolbar from '../components/Toolbar';
import { APP_NAME } from '../landing/landingConfig';
import { getStoredUser } from '../auth/authClient';
import { isEnterpriseDemoDiagram, loadDemoDiagrams } from '../data/enterpriseDemoSource';
import { useDiagramStore } from '../store/diagramStore';
import { normalizeTerraformFiles } from '../utils/importDiagram';
import { createSavedDiagram, deleteSavedDiagram, listSavedDiagrams, updateSavedDiagram, type SavedDiagram } from './diagramApi';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import {
  activeDiagrams,
  agentActions,
  agentMessages,
  awsConnectionSteps,
  awsOverviewCharts,
  connectedAccount,
  costRecommendations,
  dashboardKpis,
  dashboardNavItems,
  deployments,
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
  listAwsAccounts,
  listAwsRegions,
  syncAwsAccount,
  type AwsAccountRecord,
  type AwsInsights,
} from './awsApi';

function DashboardShell({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [activePage, setActivePage] = useState<DashboardPage>('overview');
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [awsAccounts, setAwsAccounts] = useState<AwsAccountRecord[]>([]);
  const [awsInsights, setAwsInsights] = useState<AwsInsights | undefined>();
  const [awsRegions, setAwsRegions] = useState<string[]>(['ap-south-1']);
  const [awsDataError, setAwsDataError] = useState('');
  const [awsDataMessage, setAwsDataMessage] = useState('');
  const [isSyncingAws, setIsSyncingAws] = useState(false);
  const activeItem = useMemo(() => dashboardNavItems.find((item) => item.id === activePage), [activePage]);
  const activeAwsAccount = awsAccounts.find((account) => account.status === 'connected') ?? awsAccounts[0];
  const accountStatusClass = activeAwsAccount?.status ?? 'offline';

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

  return (
    <div className={`dash-shell ${isSidebarExpanded ? 'dash-shell--expanded' : ''}`}>
      <aside className="dash-sidebar">
        <a className="dash-brand" href="/">
          <span>
            <CloudCog size={20} />
          </span>
          <strong>{APP_NAME}</strong>
        </a>
        <div className="dash-sidebar-actions">
          <button
            aria-label={isSidebarExpanded ? 'Minimize sidebar' : 'Expand sidebar'}
            className="dash-sidebar-toggle"
            onClick={() => setIsSidebarExpanded((value) => !value)}
            title={isSidebarExpanded ? 'Minimize sidebar' : 'Expand sidebar'}
          >
            {isSidebarExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button className="dash-new-button" onClick={() => setActivePage('builder')}>
            <Plus size={15} />
            <span>New Diagram</span>
          </button>
        </div>
        <nav className="dash-nav">
          {dashboardNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={activePage === item.id ? 'active' : ''} key={item.id} onClick={() => setActivePage(item.id)} title={item.label}>
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
            <button className="dash-icon-button">
              <Bell size={17} />
            </button>
            <button className="dash-icon-button" onClick={onToggleTheme} title={getThemeToggleTitle(theme)}>
              {theme === 'dark' ? <Sun size={17} /> : theme === 'light' ? <Sparkles size={17} /> : <Moon size={17} />}
            </button>
            <a className="dash-secondary-action" href="/">
              <LogOut size={16} />
              Logout
            </a>
          </div>
        </header>
        {awsDataError && <div className="dash-global-error">{awsDataError}</div>}
        {awsDataMessage && <div className="dash-global-success">{awsDataMessage}</div>}
        <div className="dash-content">
          {renderPage(activePage, setActivePage, {
            awsAccounts,
            awsInsights,
            awsRegions,
            onAwsChanged: refreshAwsData,
            onSyncAws: syncActiveAwsAccount,
            isSyncingAws,
          }, theme, onToggleTheme)}
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
) {
  switch (activePage) {
    case 'builder':
      return <VisualBuilderPage theme={theme} onToggleTheme={onToggleTheme} />;
    case 'terraform':
      return <TerraformPage />;
    case 'ai-agent':
      return <AgentPage />;
    case 'aws-insights':
      return <InsightsPage insights={awsContext.awsInsights} isSyncingAws={awsContext.isSyncingAws} onSyncAws={awsContext.onSyncAws} />;
    case 'deployments':
      return <DeploymentsPage />;
    case 'security':
      return <SecurityPage insights={awsContext.awsInsights} />;
    case 'cost':
      return <CostPage insights={awsContext.awsInsights} isSyncingAws={awsContext.isSyncingAws} onSyncAws={awsContext.onSyncAws} />;
    case 'connect-aws':
      return <ConnectAwsPage accounts={awsContext.awsAccounts} regions={awsContext.awsRegions} onAwsChanged={awsContext.onAwsChanged} />;
    default:
      return <OverviewPage setActivePage={setActivePage} insights={awsContext.awsInsights} />;
  }
}

function OverviewPage({ setActivePage, insights }: { setActivePage: (page: DashboardPage) => void; insights?: AwsInsights }) {
  return (
    <div className="dash-page">
      <KpiGrid insights={insights} />
      <div className="dash-inline-actions">
        <button className="dash-primary-action" onClick={() => setActivePage('builder')}>
          Start Building
          <ArrowRight size={17} />
        </button>
        <button className="dash-secondary-action" onClick={() => setActivePage('connect-aws')}>
          Connect AWS Account
          <ExternalLink size={16} />
        </button>
      </div>

      <OverviewAwsGraphs insights={insights} />

      <div className="dash-two-col">
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
        <Panel title="AI recommendations" action="Ask agent">
          <div className="dash-rec-list">
            {costRecommendations.length ? (
              costRecommendations.slice(0, 3).map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title}>
                    <Icon size={17} />
                    <span>{item.title}</span>
                    <strong>{item.savings}</strong>
                  </div>
                );
              })
            ) : (
              <EmptyState>Connect AWS to generate real recommendations.</EmptyState>
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
  const [demoDiagrams, setDemoDiagrams] = useState<SavedDiagram[]>([]);
  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>([]);
  const [currentDiagramId, setCurrentDiagramId] = useState<string>();
  const [currentDiagramName, setCurrentDiagramName] = useState('Untitled diagram');
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [isSavingDiagram, setIsSavingDiagram] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [directoryMessage, setDirectoryMessage] = useState('');
  const { nodes, edges, issues, activeRegion, validate, setDark, importDiagram, markSaved } = useDiagramStore();
  const user = getStoredUser();
  const canWriteDiagrams = canRoleWriteDiagrams(user?.role);
  const canDeleteDiagrams = canRoleDeleteDiagrams(user?.role);
  const directoryDiagrams = useMemo(() => [...demoDiagrams, ...savedDiagrams], [demoDiagrams, savedDiagrams]);

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

  function selectSavedDiagram(diagramId: string) {
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
      const saved = currentDiagramId && !isEnterpriseDemoDiagram(currentDiagramId) ? await updateSavedDiagram(currentDiagramId, payload) : await createSavedDiagram(payload);
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

  if (isDeploymentPageOpen) {
    return (
      <div className="dash-page dash-page--builder dash-page--deployment">
        <DeploymentModal nodes={nodes} edges={edges} issues={issues} onValidate={validate} onClose={() => setIsDeploymentPageOpen(false)} />
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
              <select value={currentDiagramId ?? ''} onChange={(event) => selectSavedDiagram(event.target.value)} disabled={isLoadingDirectory || !directoryDiagrams.length}>
                <option value="">{isLoadingDirectory ? 'Loading diagrams...' : directoryDiagrams.length ? 'Select saved diagram' : 'No saved diagrams'}</option>
                {directoryDiagrams.map((diagram) => (
                  <option value={diagram._id} key={diagram._id}>
                    {diagram.name} ({diagram.nodes?.length ?? 0} nodes)
                  </option>
                ))}
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
                disabled={isLoadingDirectory || !currentDiagramId || isEnterpriseDemoDiagram(currentDiagramId)}
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
          <Sidebar isCollapsed={isServicePanelCollapsed} onToggleCollapsed={() => setIsServicePanelCollapsed((value) => !value)} />
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
      <div className="dash-two-col dash-two-col--wide">
        <Panel title="Generated files" action="Regenerate">
          <div className="dash-file-list">
            {terraformFiles.length ? (
              terraformFiles.map((file) => (
                <div key={file.name}>
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
  return (
    <div className="dash-page">
      <div className="dash-agent-layout">
        <Panel title="Agent conversation" action="New chat">
          <div className="dash-chat">
            {agentMessages.length ? (
              agentMessages.map((message, index) => (
                <div className={`dash-chat-bubble dash-chat-bubble--${message.role}`} key={`${message.role}-${index}`}>
                  {message.text}
                </div>
              ))
            ) : (
              <EmptyState>Ask a question after connecting AWS or creating a diagram.</EmptyState>
            )}
          </div>
          <div className="dash-chat-input">
            <input placeholder="Ask about cost, Lambda errors, IAM risk, idle resources..." />
            <button>
              <ArrowRight size={16} />
            </button>
          </div>
        </Panel>
        <Panel title="Suggested agent actions" action="Run all checks">
          <div className="dash-agent-actions">
            {agentActions.map((action) => (
              <button key={action}>
                <Sparkles size={15} />
                {action}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function InsightsPage({ insights, isSyncingAws, onSyncAws }: { insights?: AwsInsights; isSyncingAws: boolean; onSyncAws: () => Promise<void> }) {
  return (
    <div className="dash-page">
      <div className="dash-inline-actions">
        <button className="dash-primary-action" disabled={isSyncingAws} onClick={() => void onSyncAws()}>
          <CloudCog size={16} />
          {isSyncingAws ? 'Syncing AWS...' : 'Sync live AWS data'}
        </button>
      </div>
      {insights && <PermissionErrorList insights={insights} />}
      <KpiGrid insights={insights} />
      <div className="dash-two-col dash-two-col--wide">
        <Panel title="Resource inventory" action={insights?.syncedAt ? `Synced ${new Date(insights.syncedAt).toLocaleString()}` : 'No live sync'}>
          <ResourceTable insights={insights} />
        </Panel>
        <Panel title="Recent AWS events" action="CloudTrail">
          <RecentAwsEvents insights={insights} />
        </Panel>
      </div>
    </div>
  );
}

function DeploymentsPage() {
  return (
    <div className="dash-page">
      <div className="dash-inline-actions">
        <button className="dash-primary-action">
          <Rocket size={16} />
          Deploy selected plan
        </button>
      </div>
      <Panel title="Deployment pipeline" action="View logs">
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
      </Panel>
      <Panel title="Recent deployment plans" action="Create plan">
        <div className="dash-deploy-grid">
          {deployments.length ? (
            deployments.map((deploy) => (
              <div className="dash-deploy-card" key={deploy.app}>
                <strong>{deploy.app}</strong>
                <span>{deploy.env}</span>
                <div>{deploy.resources} resources</div>
                <em>{deploy.status}</em>
                <small>Drift: {deploy.drift}</small>
              </div>
            ))
          ) : (
            <EmptyState>No deployment plans yet. Generate Terraform from a diagram first.</EmptyState>
          )}
        </div>
      </Panel>
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

function CostPage({ insights, isSyncingAws, onSyncAws }: { insights?: AwsInsights; isSyncingAws: boolean; onSyncAws: () => Promise<void> }) {
  const recommendations =
    insights?.recommendations.map((item) => ({
      title: item.title,
      savings: `$${item.savings}/mo`,
      effort: item.effort,
      icon: Server,
    })) ?? costRecommendations;

  const billingCards = insights
    ? [
        {
          label: 'Month-to-date spend',
          value: `$${insights.billing.monthlySpend.toFixed(2)}`,
          caption: insights.syncedAt ? `Updated ${new Date(insights.syncedAt).toLocaleString()}` : 'From Cost Explorer',
          icon: BadgeDollarSign,
        },
        {
          label: 'Estimated savings',
          value: `$${insights.billing.estimatedSavings.toFixed(2)}`,
          caption: `${insights.recommendations.length} optimization actions`,
          icon: CheckCircle2,
        },
        {
          label: 'Billing services',
          value: String(insights.billing.byService.length),
          caption: 'Cost Explorer service groups',
          icon: Server,
        },
      ]
    : [];

  return (
    <div className="dash-page">
      <div className="dash-inline-actions">
        <button className="dash-primary-action" disabled={isSyncingAws} onClick={() => void onSyncAws()}>
          <CloudCog size={16} />
          {isSyncingAws ? 'Syncing Cost Explorer...' : 'Sync Cost Explorer'}
        </button>
      </div>
      {insights ? (
        <>
          <PermissionErrorList insights={insights} services={['Cost Explorer']} />
          <div className="dash-cost-summary">
            {billingCards.map((card) => {
              const Icon = card.icon;
              return (
                <div className="dash-cost-summary-card" key={card.label}>
                  <Icon size={20} />
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.caption}</small>
                </div>
              );
            })}
          </div>

          <div className="dash-two-col dash-two-col--wide">
            <Panel title="Cost Explorer by service" action="Current month">
              <BillingServiceTable insights={insights} />
            </Panel>
            <Panel title="Cost-linked resource inventory" action="Live AWS sync">
              <ResourceTable insights={insights} />
            </Panel>
          </div>
        </>
      ) : (
        <EmptyState>Connect AWS to load Cost Explorer billing data.</EmptyState>
      )}

      <div className="dash-cost-grid">
        {recommendations.length
          ? recommendations.map((item) => {
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
            })
          : insights && <EmptyState>No Cost Explorer recommendations generated yet.</EmptyState>}
      </div>
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

function ConnectAwsPage({ accounts, regions, onAwsChanged }: { accounts: AwsAccountRecord[]; regions: string[]; onAwsChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [defaultRegion, setDefaultRegion] = useState(regions[0] ?? 'ap-south-1');
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!regions.includes(defaultRegion) && regions[0]) setDefaultRegion(regions[0]);
  }, [defaultRegion, regions]);

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
    const confirmed = window.confirm(`Disconnect ${account.name} from InfraPilot? Live AWS insights and sync will stop for this account.`);
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
              <input value={roleArn} onChange={(event) => setRoleArn(event.target.value)} placeholder="arn:aws:iam::123456789012:role/InfraPilotRole" required />
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="dash-empty-state">{children}</div>;
}

function KpiGrid({ insights }: { insights?: AwsInsights }) {
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
    <section className="dash-kpi-grid">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div className={`dash-kpi-card dash-tone-${kpi.tone}`} key={kpi.label}>
            <Icon size={20} />
            <strong>{kpi.value}</strong>
            <span>{kpi.label}</span>
            <em>{kpi.change}</em>
          </div>
        );
      })}
    </section>
  );
}

function ResourceTable({ insights }: { insights?: AwsInsights }) {
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
    <div className="dash-resource-table">
      {inventory.map((resource) => {
        const Icon = resource.icon;
        return (
          <div key={resource.service}>
            <Icon size={17} />
            <strong>{resource.service}</strong>
            <span>{resource.count} active</span>
            <span>{resource.health}</span>
            <em>{resource.spend}</em>
          </div>
        );
      })}
    </div>
  );
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
