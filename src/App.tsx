import { useEffect, useState } from 'react';
import AuthPage from './auth/AuthPage';
import { validateStoredSession } from './auth/authClient';
import DashboardShell from './dashboard/DashboardShell';
import LandingPage from './landing/LandingPage';
import ReferenceDocsPage from './reference/ReferenceDocsPage';
import GithubSettingsPage from './settings/GithubSettingsPage';
import { getNextTheme, isThemeMode, type ThemeMode } from './theme';

function App() {
  const path = window.location.pathname;
  const requiresAuth = path === '/dashboard' || path === '/settings' || path === '/profile';
  const [isProtectedRouteAllowed, setIsProtectedRouteAllowed] = useState(!requiresAuth);
  const [isValidatingProtectedRoute, setIsValidatingProtectedRoute] = useState(requiresAuth);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('infra-theme');
    return isThemeMode(saved) ? saved : 'dark';
  });

  useEffect(() => {
    window.localStorage.setItem('infra-theme', theme);
  }, [theme]);

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

  let page = <LandingPage theme={theme} onToggleTheme={toggleTheme} />;

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
        <DashboardShell theme={theme} onToggleTheme={toggleTheme} />
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
        <GithubSettingsPage theme={theme} onToggleTheme={toggleTheme} />
      );
  }

  if (path === '/references') {
    page = <ReferenceDocsPage theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (path === '/login') {
    page = <AuthPage mode="login" theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (path === '/register') {
    page = <AuthPage mode="register" theme={theme} onToggleTheme={toggleTheme} />;
  }

  const themeClassName =
    theme === 'pearl' ? 'app-theme app-theme-light app-theme-pearl' : `app-theme app-theme-${theme} ${theme === 'dark' ? 'dark' : ''}`;

  return <div className={themeClassName}>{page}</div>;

}

export default App;
