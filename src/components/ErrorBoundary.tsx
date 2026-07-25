import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

// The app previously had no error boundary anywhere — any unhandled render exception (most
// likely from the large DashboardShell.tsx page tree) took down the entire UI with a blank white
// screen and no way for the user to recover short of a manual reload. This is the single
// top-level catch-all; individual features can add more granular boundaries later if a specific
// page turns out to need isolation from the rest of the app.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="error-boundary-page">
        <div className="error-boundary-card">
          <span className="error-boundary-eyebrow">Something went wrong</span>
          <h1>This page hit an unexpected error.</h1>
          <p>Reloading usually fixes it. If it keeps happening, the details below can help track down what broke.</p>
          <button type="button" onClick={this.handleReload}>
            Reload page
          </button>
          <pre className="error-boundary-detail">{error.message}</pre>
        </div>
      </main>
    );
  }
}
