import { useEffect, useMemo, useState } from 'react';
import { Github, LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import AppLogo from '../components/AppLogo';
import { PageAlert } from '../components/PageAlert';
import { clearAuthSession, getStoredUser } from '../auth/authClient';
import { getNextTheme, type ThemeMode } from '../theme';
import { disconnectGithub, getGithubStatus, githubOAuthUrl, type GithubConnection } from '../github/githubApi';
import { currentLegalVersions } from '../legal/legalDocs';

type SettingsPageProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export default function GithubSettingsPage({ theme, onToggleTheme }: SettingsPageProps) {
  const user = getStoredUser();
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
                <p className="legal-inline-notice">
                  By connecting GitHub, you authorize infraflow to access selected repositories and sync files per our{' '}
                  <a href="/legal/terms" rel="noreferrer" target="_blank">
                    Terms of Service
                  </a>
                  .
                </p>
                <button className="dash-primary-action" onClick={connectGithub} type="button">
                  <Github size={16} />
                  Connect GitHub
                </button>
              </div>
            )}
          </div>
        </article>

        <article className="settings-legal-card">
          <div className="settings-heading settings-heading--compact">
            <span className="dash-eyebrow">Legal</span>
            <h2>Legal documents</h2>
            <p>Current document versions and the versions accepted by your account.</p>
          </div>
          <div className="settings-legal-grid">
            <a href="/legal/terms" rel="noreferrer" target="_blank">
              <strong>Terms of Service</strong>
              <span>Current: {currentLegalVersions.terms}</span>
              <span>Accepted: {user?.legalConsent?.termsVersionAccepted || 'Not recorded'}</span>
            </a>
            <a href="/legal/privacy" rel="noreferrer" target="_blank">
              <strong>Privacy Policy</strong>
              <span>Current: {currentLegalVersions.privacy}</span>
              <span>Accepted: {user?.legalConsent?.privacyVersionAccepted || 'Not recorded'}</span>
            </a>
          </div>
          <p className="settings-legal-accepted">
            Accepted at:{' '}
            {user?.legalConsent?.acceptedAt ? new Date(user.legalConsent.acceptedAt).toLocaleString() : 'Not recorded'}
          </p>
        </article>
      </section>
    </main>
  );
}
