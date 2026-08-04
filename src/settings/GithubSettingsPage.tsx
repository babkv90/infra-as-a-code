import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, Check, Github, LayoutGrid, LogOut, Mail, Moon, Network, PenTool, RefreshCw, ShieldCheck, Sun, UserCircle } from 'lucide-react';
import AppLogo from '../components/AppLogo';
import GithubConsentInfo from '../components/GithubConsentInfo';
import { PageAlert } from '../components/PageAlert';
import { clearAuthSession, getStoredUser } from '../auth/authClient';
import { useDiagramStore } from '../store/diagramStore';
import { getNextTheme, type ThemeMode } from '../theme';
import { disconnectGithub, getGithubStatus, githubOAuthUrl, type GithubConnection } from '../github/githubApi';
import { getAccessPlan, serviceAccessTierForUser } from '../utils/accessControl';

type SettingsPageProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export default function GithubSettingsPage({ theme, onToggleTheme }: SettingsPageProps) {
  const user = getStoredUser();
  const whiteboardMode = useDiagramStore((state) => state.whiteboardMode);
  const setWhiteboardMode = useDiagramStore((state) => state.setWhiteboardMode);
  const architectureViewMode = useDiagramStore((state) => state.architectureViewMode);
  const setArchitectureViewMode = useDiagramStore((state) => state.setArchitectureViewMode);
  const hasDiagramNodes = useDiagramStore((state) => state.nodes.length > 0);
  const autoArrangeDiagram = useDiagramStore((state) => state.autoArrange);
  const accessPlan = getAccessPlan(user);
  const accessTier = serviceAccessTierForUser(user);
  const profileInitials = (user?.name || user?.email || 'U')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const [connection, setConnection] = useState<GithubConnection>({ connected: false, login: '', scopes: [] });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const redirectNotice = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      status: params.get('github'),
      message: params.get('github_message'),
    };
  }, []);

  useEffect(() => {
    if (redirectNotice.status === 'connected') setMessage('GitHub connected successfully.');
    if (redirectNotice.status === 'error') setError(redirectNotice.message || 'GitHub connection failed.');
    if (redirectNotice.status) window.history.replaceState({}, '', window.location.pathname);
  }, [redirectNotice]);

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    setIsLoading(true);
    try {
      const status = await getGithubStatus();
      setConnection(status);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to load GitHub status.');
    } finally {
      setIsLoading(false);
    }
  }

  function connectGithub() {
    window.location.href = githubOAuthUrl({ mode: 'redirect', returnTo: '/settings' });
  }

  async function disconnect() {
    setIsDisconnecting(true);
    setMessage('');
    setError('');
    try {
      await disconnectGithub();
      setConnection({ connected: false, login: '', scopes: [] });
      setMessage('GitHub disconnected.');
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect GitHub.');
    } finally {
      setIsDisconnecting(false);
    }
  }

  function signOut() {
    clearAuthSession();
    window.location.replace('/login');
  }

  return (
    <main className="settings-page">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {error && <PageAlert message={error} tone="error" onDismiss={() => setError('')} />}
      <header className="settings-topbar">
        <a href="/dashboard" aria-label="Dashboard">
          <AppLogo className="app-logo--dashboard" />
        </a>
        <div>
          <a className="dash-secondary-action" href="/dashboard">
            Dashboard
          </a>
          <button className="dash-secondary-action" onClick={onToggleTheme} title={`Switch to ${getNextTheme(theme)} theme`} type="button">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            Theme
          </button>
          <button className="dash-secondary-action" onClick={signOut} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      <section className="settings-panel">
        <div className="settings-heading">
          <span className="dash-eyebrow">Profile settings</span>
          <h1>Connected accounts</h1>
          <p>{user?.email}</p>
        </div>

        <article className="settings-profile-card" aria-label="User profile information">
          <div className="settings-profile-card__identity">
            <div className="settings-profile-avatar">
              {profileInitials || <UserCircle size={28} />}
            </div>
            <div>
              <span className="dash-eyebrow">User profile</span>
              <strong>{user?.name || 'Unnamed user'}</strong>
              <p>{user?.email || 'No email recorded'}</p>
            </div>
          </div>
          <div className="settings-profile-grid">
            <div>
              <Mail size={15} />
              <span>Email</span>
              <strong>{user?.email || 'Not recorded'}</strong>
            </div>
            <div>
              <ShieldCheck size={15} />
              <span>Role</span>
              <strong>{user?.role || 'viewer'}</strong>
            </div>
            <div>
              <BadgeCheck size={15} />
              <span>Access plan</span>
              <strong>{accessTier} / {accessPlan}</strong>
            </div>
            <div>
              <Building2 size={15} />
              <span>Workspace</span>
              <strong>{user?.workspaceName || user?.workspace || 'Personal workspace'}</strong>
            </div>
            <div>
              <UserCircle size={15} />
              <span>Status</span>
              <strong>{user?.status || 'active'}</strong>
            </div>
            <div>
              <RefreshCw size={15} />
              <span>Demo credits</span>
              <strong>{Number(user?.demoCredits ?? 0)}</strong>
            </div>
          </div>
        </article>

        <article className="settings-github-card">
          <div className="settings-github-card__main">
            <div className="settings-github-icon">
              <LayoutGrid size={22} />
            </div>
            <div>
              <strong>Application canvas</strong>
              <span>Choose the default diagram style used by the visual builder.</span>
            </div>
          </div>
          <div className="settings-canvas-actions">
            <button
              className={`dash-secondary-action ${!whiteboardMode && !architectureViewMode ? 'is-active' : ''}`}
              onClick={() => {
                setWhiteboardMode(false);
                setArchitectureViewMode(false);
              }}
              type="button"
            >
              <LayoutGrid size={16} />
              Diagram
              {!whiteboardMode && !architectureViewMode && <Check size={15} />}
            </button>
            <button className={`dash-secondary-action ${whiteboardMode ? 'is-active' : ''}`} onClick={() => setWhiteboardMode(true)} type="button">
              <PenTool size={16} />
              Whiteboard
              {whiteboardMode && <Check size={15} />}
            </button>
            <button
              className={`dash-secondary-action ${architectureViewMode ? 'is-active' : ''}`}
              onClick={() => {
                setArchitectureViewMode(true);
                if (hasDiagramNodes) void autoArrangeDiagram();
              }}
              title="Dark, column-laned architecture diagram — Client / Edge-CDN / Network / Load Balancing / Compute / Data / Supporting Services"
              type="button"
            >
              <Network size={16} />
              Architecture
              {architectureViewMode && <Check size={15} />}
            </button>
          </div>
        </article>

        <article className="settings-github-card">
          <div className="settings-github-card__main">
            <div className="settings-github-icon">
              <Github size={22} />
            </div>
            <div>
              <strong>GitHub</strong>
              {isLoading ? (
                <span>Checking connection...</span>
              ) : connection.connected ? (
                <span>Connected as @{connection.login}</span>
              ) : (
                <span>Connect GitHub to select repositories and sync generated deployment files.</span>
              )}
            </div>
          </div>

          {connection.connected && (
            <div className="settings-github-profile">
              {connection.avatarUrl && <img alt="" src={connection.avatarUrl} />}
              <div>
                <strong>@{connection.login}</strong>
                <span>{connection.connectedAt ? `Connected ${new Date(connection.connectedAt).toLocaleString()}` : 'Connected'}</span>
              </div>
            </div>
          )}

          {(connection.reconnectRequired || (connection.connected && Boolean(connection.scopes?.length) && !connection.scopes.includes('workflow'))) && (
            <div className="dash-global-warning">
              GitHub is missing required OAuth permissions{connection.missingScopes?.length ? `: ${connection.missingScopes.join(', ')}` : ''}. Reconnect to sync generated GitHub Actions files.
              <button className="dash-secondary-action" onClick={connectGithub} type="button">
                Reconnect GitHub
              </button>
            </div>
          )}

          <div className="settings-github-actions">
            <button className="dash-secondary-action" disabled={isLoading} onClick={() => void refreshStatus()} type="button">
              <RefreshCw size={16} />
              Refresh
            </button>
            {connection.connected ? (
              <button className="dash-primary-action" disabled={isDisconnecting} onClick={() => void disconnect()} type="button">
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <div className="legal-connect-group">
                <GithubConsentInfo />
                <button className="dash-primary-action" onClick={connectGithub} type="button">
                  <Github size={16} />
                  Connect GitHub
                </button>
              </div>
            )}
          </div>
        </article>

      </section>
    </main>
  );
}
