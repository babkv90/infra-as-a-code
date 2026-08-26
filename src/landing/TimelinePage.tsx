// The landing page's "Progress Timeline" / changelog blog. Every card here is a real document
// (.pdf/.md/.docx) living in one of the folders IAAS backend/src/services/timelineScanner.js
// scans — there's no separate CMS or database table. Dropping a new file into one of those
// folders is the entire "publish" step; this page just fetches whatever the backend's latest scan
// found (see timelineApi.ts) and renders it as a feed.
import { ArrowUpDown, Download, FileText, FileType, Home, LayoutDashboard, Moon, NotebookText, RefreshCw, Sparkles, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { validateStoredSession } from '../auth/authClient';
import AppLogo from '../components/AppLogo';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import { DASHBOARD_ROUTE } from './landingConfig';
import { getTimelineEntries, timelineFileUrl, type TimelineEntry } from './timelineApi';
import { renderInlineMarkdown } from './blocks/inlineMarkdown';

type SortDirection = 'newest' | 'oldest';

// A colorful, file-type-specific icon for each card's cover mark instead of a plain "MD"/"PDF"
// text label — colors follow the conventions people already know (PDF = red, Word-ish = blue).
const FILE_TYPE_ICON: Record<string, { Icon: LucideIcon; color: string }> = {
  md: { Icon: NotebookText, color: '#2563eb' },
  pdf: { Icon: FileText, color: '#dc2626' },
  docx: { Icon: FileType, color: '#2563eb' },
};

function TimelinePage({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('newest');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCheckingDashboard, setIsCheckingDashboard] = useState(false);

  async function loadTimeline(forceRefresh: boolean) {
    setIsRefreshing(true);
    setError('');
    try {
      const result = await getTimelineEntries({ forceRefresh });
      setEntries(result.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the timeline.');
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadTimeline(false);
  }, []);

  // Entries arrive sorted oldest-first (their `order` field reflects that) — reversing here is
  // just a display concern, not another request.
  const sortedEntries = useMemo(() => {
    if (!entries) return [];
    return sortDirection === 'newest' ? [...entries].reverse() : entries;
  }, [entries, sortDirection]);

  async function openDashboard() {
    if (isCheckingDashboard) return;
    setIsCheckingDashboard(true);
    try {
      const user = await validateStoredSession();
      window.location.href = user ? DASHBOARD_ROUTE : `/login?next=${encodeURIComponent(DASHBOARD_ROUTE)}`;
    } finally {
      setIsCheckingDashboard(false);
    }
  }

  return (
    <div className="timeline-page">
      <header className="timeline-topbar">
        <a className="lp-logo" href="/">
          <AppLogo className="app-logo--nav" suffix="Timeline" />
        </a>
        <div className="timeline-topbar__actions">
          <a className="timeline-ghost-button" href="/">
            <Home size={15} />
            Landing
          </a>
          <button className="timeline-ghost-button" disabled={isCheckingDashboard} onClick={() => void openDashboard()} type="button">
            <LayoutDashboard size={15} />
            {isCheckingDashboard ? 'Checking...' : 'Dashboard'}
          </button>
          <button className="timeline-icon-button" onClick={onToggleTheme} title={getThemeToggleTitle(theme)} type="button">
            {theme === 'dark' ? <Sun size={16} /> : theme === 'light' ? <Sparkles size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <main className="timeline-shell">
        <div className="timeline-intro">
          <span className="timeline-eyebrow">Progress Timeline</span>
          <h1>How infraflow has evolved</h1>
          <p>
            Every design doc, plan, and report generated along the way, in order — pulled straight from the project's own docs folders, no
            separate blog to keep in sync.
          </p>
          <div className="timeline-controls">
            <button
              className="timeline-text-button"
              onClick={() => setSortDirection((current) => (current === 'newest' ? 'oldest' : 'newest'))}
              type="button"
            >
              <ArrowUpDown size={14} />
              {sortDirection === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
            <span className="timeline-controls__divider" aria-hidden="true" />
            <button className="timeline-text-button" disabled={isRefreshing} onClick={() => void loadTimeline(true)} type="button">
              <RefreshCw className={isRefreshing ? 'timeline-spin' : ''} size={14} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="timeline-error">{error}</div>}

        {!entries && !error && <div className="timeline-empty">Loading the timeline...</div>}

        {entries && entries.length === 0 && !error && (
          <div className="timeline-empty">No documents found yet — drop a .pdf, .md, or .docx into one of the source folders.</div>
        )}

        <ol className="timeline-list">
          {sortedEntries.map((entry) => {
            const { Icon: MarkIcon, color: markColor } = FILE_TYPE_ICON[entry.ext] ?? { Icon: FileText, color: '#64748b' };
            return (
            <li className="timeline-row" key={entry.id}>
              <a
                className="timeline-row__mark"
                href={`/blog/${entry.id}`}
                aria-hidden="true"
                style={{ background: `${markColor}26`, border: `1px solid ${markColor}40` }}
                tabIndex={-1}
              >
                <MarkIcon color={markColor} size={30} strokeWidth={1.75} />
              </a>
              <div className="timeline-row__body">
                <div className="timeline-row__meta">
                  <time dateTime={entry.date}>{formatDate(entry.date)}</time>
                  {entry.tags.map((tag) => (
                    <span className="timeline-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <h2>
                  <a href={`/blog/${entry.id}`}>{entry.title}</a>
                </h2>
                <p className="timeline-row__excerpt">{renderInlineMarkdown(entry.summary)}</p>
                <div className="timeline-row__footer">
                  <span className="timeline-row__filemeta">
                    <FileText size={13} />
                    {entry.ext.toUpperCase()}
                    {typeof entry.pageCount === 'number' ? ` · ${entry.pageCount} pages` : ''} · {formatSize(entry.sizeBytes)}
                  </span>
                  <a className="timeline-download-link" download={entry.sourceFileName} href={timelineFileUrl(entry.id)}>
                    <Download size={13} />
                    Download
                  </a>
                </div>
              </div>
            </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default TimelinePage;
