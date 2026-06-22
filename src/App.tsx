import { useEffect, useState } from 'react';
import AuthPage from './auth/AuthPage';
import DashboardShell from './dashboard/DashboardShell';
import LandingPage from './landing/LandingPage';
import { getNextTheme, isThemeMode, type ThemeMode } from './theme';

function App() {
  const path = window.location.pathname;
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('infra-theme');
    return isThemeMode(saved) ? saved : 'dark';
  });

  useEffect(() => {
    window.localStorage.setItem('infra-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(getNextTheme);

  let page = <LandingPage theme={theme} onToggleTheme={toggleTheme} />;

  if (path === '/dashboard') {
    page = <DashboardShell theme={theme} onToggleTheme={toggleTheme} />;
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
