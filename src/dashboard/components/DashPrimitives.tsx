import type React from 'react';

// Small, dependency-free building blocks shared across dashboard pages. Pulled out of
// DashboardShell.tsx specifically so extracted page files (AgentPage.tsx, SupportPage.tsx, etc.)
// can import them without creating a circular import back into DashboardShell.tsx itself.
export function Panel({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return (
    <section className="dash-panel">
      <header>
        <h2>{title}</h2>
        {action && <button>{action}</button>}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="dash-empty-state">{children}</div>;
}
