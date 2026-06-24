import { BookOpen, Download, ExternalLink, FileText, Home, LayoutDashboard, Moon, Sparkles, Sun } from 'lucide-react';
import { useMemo, useState } from 'react';
import { validateStoredSession } from '../auth/authClient';
import { APP_NAME, DASHBOARD_ROUTE } from '../landing/landingConfig';
import { getThemeToggleTitle, type ThemeMode } from '../theme';

type ReferenceDoc = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  example: string;
  url: string;
};

const referenceDocs: ReferenceDoc[] = [
  {
    id: 'node-runtime-lab',
    title: 'Node Runtime Lab Reference',
    subtitle: 'Processes, workers, CPU cores, clusters',
    description: 'Learn how this app demonstrates worker threads, child processes, cluster workers, CPU usage, memory, and safe background execution.',
    example: 'Use this when studying why Terraform generation, AWS sync, or heavy architecture validation should run outside the main API request path.',
    url: '/api/v1/reference-docs/node-runtime-lab',
  },
  {
    id: 'infrapilot-architecture',
    title: 'InfraPilot Full Stack Architecture',
    subtitle: 'Frontend, backend, MongoDB, AWS HLD/LLD',
    description: 'Study the React, Node, MongoDB, and AWS architecture for scaling this application toward millions of users.',
    example: 'Use this when learning how the landing page, dashboard, backend routes, MongoDB persistence, AWS integrations, and deployment architecture fit together.',
    url: '/api/v1/reference-docs/infrapilot-architecture',
  },
];

function ReferenceDocsPage({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const [activeDocId, setActiveDocId] = useState(referenceDocs[0].id);
  const [isCheckingDashboard, setIsCheckingDashboard] = useState(false);
  const activeDoc = useMemo(() => referenceDocs.find((doc) => doc.id === activeDocId) ?? referenceDocs[0], [activeDocId]);
  const pdfUrl = `${activeDoc.url}#toolbar=1&navpanes=1&view=FitH`;

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
    <div className="reference-page">
      <header className="reference-topbar">
        <a className="lp-logo" href="/">
          <span className="lp-logo-mark">
            <FileText size={20} />
          </span>
          <span>{APP_NAME} Reference</span>
        </a>
        <div className="reference-actions">
          <a className="dash-secondary-action" href="/">
            <Home size={16} />
            Landing
          </a>
          <button className="dash-secondary-action" disabled={isCheckingDashboard} onClick={() => void openDashboard()} type="button">
            <LayoutDashboard size={16} />
            {isCheckingDashboard ? 'Checking...' : 'Dashboard'}
          </button>
          <button className="dash-icon-button" onClick={onToggleTheme} title={getThemeToggleTitle(theme)} type="button">
            {theme === 'dark' ? <Sun size={17} /> : theme === 'light' ? <Sparkles size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="reference-shell">
        <aside className="reference-sidebar">
          <div>
            <span className="dash-eyebrow">Interactive PDFs</span>
            <h1>InfraPilot Lab Reference</h1>
            <p>Open the generated documentation inside the app and switch between architecture and runtime learning references.</p>
          </div>

          <div className="reference-doc-list">
            {referenceDocs.map((doc) => (
              <button className={activeDoc.id === doc.id ? 'active' : ''} key={doc.id} onClick={() => setActiveDocId(doc.id)} type="button">
                <FileText size={18} />
                <strong>{doc.title}</strong>
                <span>{doc.subtitle}</span>
              </button>
            ))}
          </div>

          <section className="reference-context">
            <BookOpen size={18} />
            <h2>{activeDoc.title}</h2>
            <p>{activeDoc.description}</p>
            <em>{activeDoc.example}</em>
          </section>
        </aside>

        <section className="reference-reader">
          <header>
            <div>
              <span>{activeDoc.subtitle}</span>
              <h2>{activeDoc.title}</h2>
            </div>
            <div>
              <a href={activeDoc.url} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Open
              </a>
              <a href={activeDoc.url} download>
                <Download size={16} />
                Download
              </a>
            </div>
          </header>
          <iframe title={activeDoc.title} src={pdfUrl} />
        </section>
      </main>
    </div>
  );
}

export default ReferenceDocsPage;
