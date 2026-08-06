import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './utils/analytics';
import 'reactflow/dist/style.css';
import './styles.css';
// After styles.css on purpose: builder rules win where the two overlap.
import './styles/builder.css';

initializeAnalytics();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
