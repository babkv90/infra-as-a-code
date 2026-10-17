import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './utils/analytics';
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
