// The in-app reader behind a timeline card's "View" link — a Medium-style article page rendering
// the document's own structure (headings/code/tables/lists/quotes/images/diagrams, see
// timelineScanner.js's block parser and blocks/ContentBlocks.tsx's renderers) rather than dropping
// the visitor onto a raw PDF/file response. "Download" still links straight at the file itself for
// anyone who wants the source document.
import { ArrowLeft, Calendar, Clock, Download, Home, LayoutDashboard, Moon, Sparkles, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { validateStoredSession } from '../auth/authClient';
import AppLogo from '../components/AppLogo';
import { getThemeToggleTitle, type ThemeMode } from '../theme';
import { ArticleBody, computeHeadingIds, getHeadingOutline } from './blocks/ContentBlocks';
import { renderInlineMarkdown } from './blocks/inlineMarkdown';
import { ReadingProgressBar } from './blocks/ReadingProgressBar';
import { TableOfContents } from './blocks/TableOfContents';
import { DASHBOARD_ROUTE } from './landingConfig';
import { getTimelineEntry, timelineFileUrl, type TimelineEntryDetail } from './timelineApi';

function TimelineArticlePage({ id, theme, onToggleTheme }: { id: string; theme: ThemeMode; onToggleTheme: () => void }) {
  const [detail, setDetail] = useState<TimelineEntryDetail | null>(null);
  const [error, setError] = useState('');
  const [isCheckingDashboard, setIsCheckingDashboard] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setDetail(null);
    setError('');

    getTimelineEntry(id)
      .then((result) => {
        if (isCurrent) setDetail(result);
      })
      .catch((loadError) => {
        if (isCurrent) setError(loadError instanceof Error ? loadError.message : 'Unable to load this document.');
      });

    return () => {
      isCurrent = false;
    };
  }, [id]);

  const headingIds = useMemo(() => (detail ? computeHeadingIds(detail.blocks) : []), [detail]);
  const headingOutline = useMemo(() => (detail ? getHeadingOutline(detail.blocks) : []), [detail]);

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
      {detail && <ReadingProgressBar />}
      <header className="timeline-topbar">
        <a className="lp-logo" href="/">
          <AppLogo className="app-logo--nav" suffix="Timeline" />
        </a>
        <div className="timeline-topbar__actions">
          <a className="timeline-ghost-button" href="/blog">
            <ArrowLeft size={15} />
            Timeline
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

      <main className="timeline-article-shell">
        {error && <div className="timeline-error">{error}</div>}
        {!detail && !error && <div className="timeline-empty">Loading...</div>}

        {detail && (
          <div className="timeline-article-layout">
            <article className="timeline-article">
              <div className="timeline-article__meta">
                {detail.entry.tags.map((tag) => (
                  <span className="timeline-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>

              <h1>{detail.entry.title}</h1>
              <p className="timeline-article__subtitle">{renderInlineMarkdown(detail.entry.summary)}</p>

              <div className="timeline-article__byline">
                <Calendar size={14} />
                <time dateTime={detail.entry.date}>{formatDate(detail.entry.date)}</time>
                <span className="timeline-article__byline-dot" aria-hidden="true" />
                <Clock size={14} />
                <span>{detail.readingTimeMinutes} min read</span>
              </div>

              <div className="timeline-article__actions">
                <a className="timeline-button timeline-button--primary" download={detail.entry.sourceFileName} href={timelineFileUrl(detail.entry.id)}>
                  <Download size={14} />
                  Download
                </a>
              </div>

              <ArticleBody blocks={detail.blocks} headingIds={headingIds} theme={theme} />

              <div className="timeline-article__footer">
                <a className="timeline-ghost-button" href="/blog">
                  <Home size={15} />
                  Back to the timeline
                </a>
              </div>
            </article>

            <TableOfContents headings={headingOutline} />
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default TimelineArticlePage;
