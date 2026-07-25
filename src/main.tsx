import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './utils/analytics';
import './styles.css';
import 'reactflow/dist/style.css';

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
