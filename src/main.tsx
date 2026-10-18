import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './utils/analytics';
import { API_BASE_URL } from './utils/apiBaseUrl';
import { UiExperienceProvider } from './ui/UiExperience';
import 'reactflow/dist/style.css';
import './styles.css';
// After styles.css on purpose: builder rules win where the two overlap.
import './styles/builder.css';
import './styles/studio.css';
import './styles/workspace-studio.css';
import './styles/auth-studio.css';
import './styles/overview-studio.css';
import './styles/builder-studio.css';
import './styles/compact-workspace.css';
import './styles/momentum.css';
import './styles/builder-compact.css';
import './styles/table-scroll.css';

// Dev only: the local API is 127.0.0.1:4001, and to the browser localhost is a different site, so
// the refresh cookie would never reach /auth/refresh and every reload would sign you out.
const isDevSiteMismatch =
  import.meta.env.DEV && window.location.hostname === 'localhost' && new URL(API_BASE_URL, window.location.href).hostname === '127.0.0.1';

if (isDevSiteMismatch) {
  window.location.replace(window.location.href.replace('//localhost', '//127.0.0.1'));
} else {
  initializeAnalytics();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ReactFlowProvider>
          <UiExperienceProvider><App /></UiExperienceProvider>
        </ReactFlowProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
