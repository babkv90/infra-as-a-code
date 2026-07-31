import type React from 'react';

// Small, dependency-free building blocks shared across dashboard pages. Pulled out of
// DashboardShell.tsx specifically so extracted page files (AgentPage.tsx, SupportPage.tsx, etc.)
// can import them without creating a circular import back into DashboardShell.tsx itself.
export function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dash-panel">
      <header>
        <h2>{title}</h2>
        {typeof action === 'string' ? <button>{action}</button> : action}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="dash-empty-state">{children}</div>;
}

// Facebook-style skeleton placeholder for any table/list while its data is loading — the row shape
// (count + column widths) is visible immediately, with each cell pulsing/shimmering ("breathing")
// rather than the page showing nothing or a bare "Loading..." string. `columnWidths` are relative
// fr units, so passing e.g. [3, 2, 1, 1] roughly mirrors a wide name column next to narrower
// status/date ones — pass whatever loosely matches the real row this is standing in for.
export function TableSkeleton({ rows = 5, columnWidths = [3, 2, 1, 1] }: { rows?: number; columnWidths?: number[] }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Loading" aria-live="polite">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div className="skeleton-row" key={rowIndex} style={{ gridTemplateColumns: columnWidths.map((width) => `${width}fr`).join(' ') }}>
          {columnWidths.map((_, colIndex) => (
            <span className="skeleton-cell" key={colIndex} style={{ animationDelay: `${((rowIndex * columnWidths.length + colIndex) % 14) * 55}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
