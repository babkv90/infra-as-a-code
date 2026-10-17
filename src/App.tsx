import { useEffect, useState } from 'react';
import AuthPage from './auth/AuthPage';
import { validateStoredSession } from './auth/authClient';
import DashboardShell from './dashboard/DashboardShell';
import LandingPage from './landing/LandingPage';
import LegacyLandingPage from './landing/LegacyLandingPage';
import { UiExperienceSwitch, useUiExperience } from './ui/UiExperience';
import LegalPage from './legal/LegalPage';
import ReferenceDocsPage from './reference/ReferenceDocsPage';
import TimelineArticlePage from './landing/TimelineArticlePage';
import TimelinePage from './landing/TimelinePage';
import GithubSettingsPage from './settings/GithubSettingsPage';
import { getNextTheme, isThemeMode, type ThemeMode } from './theme';

function App() {
  const { experience } = useUiExperience();
  const path = window.location.pathname;
  if (path === '/terms' || path === '/privacy') {
    window.location.replace(path === '/terms' ? '/legal/terms' : '/legal/privacy');
    return null;
  }

  const requiresAuth = path === '/dashboard' || path === '/settings' || path === '/profile';
  const [isProtectedRouteAllowed, setIsProtectedRouteAllowed] = useState(!requiresAuth);
  const [isValidatingProtectedRoute, setIsValidatingProtectedRoute] = useState(requiresAuth);
  const [colorTheme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem('infra-theme');
      return isThemeMode(saved) ? saved : experience !== 'classic' ? 'light' : 'pearl';
    } catch { return 'light'; }
  });
  // Momentum uses the reference palette; switching back restores the previous color mode.
  const theme = experience === 'momentum' ? 'light' : colorTheme;

  useEffect(() => {
    try { window.localStorage.setItem('infra-theme', colorTheme); } catch { /* Storage is optional. */ }
  }, [colorTheme]);

  useEffect(() => {
    if (!requiresAuth) return;

    let isCurrent = true;

    async function validateProtectedAccess() {
      setIsValidatingProtectedRoute(true);

      try {
        const user = await validateStoredSession();

        if (!isCurrent) return;

        if (!user) {
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }

        setIsProtectedRouteAllowed(true);
      } catch {
        if (isCurrent) {
          window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
      } finally {
        if (isCurrent) setIsValidatingProtectedRoute(false);
      }
    }

    void validateProtectedAccess();

    return () => {
      isCurrent = false;
    };
  }, [path, requiresAuth]);

  const toggleTheme = () => setTheme(getNextTheme);

  let page = experience === 'classic' ? <LegacyLandingPage theme={theme} onToggleTheme={toggleTheme} /> : <LandingPage theme={theme} onToggleTheme={toggleTheme} onSelectTheme={setTheme} />;

  if (path === '/dashboard') {
    page =
      isValidatingProtectedRoute || !isProtectedRouteAllowed ? (
        <main className="route-guard-page">
          <div>
            <span className="dash-eyebrow">Validating session</span>
            <h1>Checking dashboard access...</h1>
          </div>
        </main>
      ) : (
        <DashboardShell theme={theme} onToggleTheme={toggleTheme} onSelectTheme={setTheme} />
      );
  }

  if (path === '/settings' || path === '/profile') {
    page =
      isValidatingProtectedRoute || !isProtectedRouteAllowed ? (
        <main className="route-guard-page">
          <div>
            <span className="dash-eyebrow">Validating session</span>
            <h1>Checking settings access...</h1>
          </div>
        </main>
      ) : (
        <GithubSettingsPage theme={theme} onToggleTheme={toggleTheme} onSelectTheme={setTheme} />
      );
  }

  if (path === '/references') {
    page = <ReferenceDocsPage theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (path === '/blog' || path === '/timeline') {
    page = <TimelinePage theme={theme} onToggleTheme={toggleTheme} />;
  }

  const blogArticleId = path.startsWith('/blog/') ? decodeURIComponent(path.slice('/blog/'.length)) : '';
  if (blogArticleId) {
    page = <TimelineArticlePage id={blogArticleId} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (path.startsWith('/legal/')) {
    page = <LegalPage path={path} />;
  }

  if (path === '/login') {
    page = <AuthPage mode="login" theme={theme} onToggleTheme={toggleTheme} onSelectTheme={setTheme} />;
  }

  if (path === '/register') {
    page = <AuthPage mode="register" theme={theme} onToggleTheme={toggleTheme} onSelectTheme={setTheme} />;
  }

  const themeClassName =
    theme === 'pearl' ? 'app-theme app-theme-light app-theme-pearl' : `app-theme app-theme-${theme} ${theme === 'dark' ? 'dark' : ''}`;

  return <div className={`${themeClassName} ui-${experience}${experience === 'momentum' ? ' ui-studio' : ''}`}>{page}{path !== '/dashboard' && <UiExperienceSwitch className="ui-public-switch" />}</div>;

}

export default App;
