import { useEffect } from 'react';
import AppLogo from '../components/AppLogo';
import { getLegalDocumentByPath } from './legalDocs';

function LegalPage({ path = window.location.pathname }: { path?: string }) {
  const legalDocument = getLegalDocumentByPath(path);

  useEffect(() => {
    if (!legalDocument) return;
    document.title = `${legalDocument.title} | infraflow`;
    setMetaDescription(legalDocument.description);
    setCanonicalUrl(`/legal/${legalDocument.slug}`);
  }, [legalDocument]);

  if (!legalDocument) {
    return (
      <main className="legal-page">
        <section className="legal-shell">
          <h1>Legal document not found</h1>
          <p>The requested legal document or version is not available.</p>
          <a className="lp-secondary-button" href="/">
            Back to home
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="legal-page">
      <header className="legal-topbar">
        <a href="/" aria-label="Home">
          <AppLogo className="app-logo--dashboard" />
        </a>
        <nav>
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <button onClick={() => window.print()} type="button">
            Download as PDF / Print
          </button>
        </nav>
      </header>

      <article className="legal-shell">
        <div className="legal-meta">
          <span className="dash-eyebrow">Legal</span>
          <h1>{legalDocument.title}</h1>
          <p>
            Version: <strong>{legalDocument.version}</strong> · Effective Date: <strong>{legalDocument.effectiveDate}</strong>
          </p>
        </div>
        <div className="legal-content" dangerouslySetInnerHTML={{ __html: legalDocument.html }} />
      </article>
    </main>
  );
}

function setMetaDescription(description: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.appendChild(meta);
  }
  meta.content = description;
}

function setCanonicalUrl(path: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = `${window.location.origin}${path}`;
}

export default LegalPage;
