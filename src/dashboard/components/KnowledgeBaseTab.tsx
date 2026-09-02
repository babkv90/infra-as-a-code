import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { FileText, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { PageAlert } from '../../components/PageAlert';
import { EmptyState } from './DashPrimitives';
import {
  deleteKnowledgeDocument,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
  type KnowledgeDocument,
} from '../superAdminApi';

const ACCEPT = '.pdf,.md,.markdown,.txt,.text,.rst,.csv,.json,.yaml,.yml';
const MAX_BYTES = 6 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBaseTab() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setIsLoading(true);
    try {
      setDocuments(await listKnowledgeDocuments());
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load the knowledge base.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setActionError(`${file.name} is ${formatBytes(file.size)}; the limit is 6 MB.`);
      return;
    }

    setIsUploading(true);
    setActionError('');
    setMessage('');
    try {
      const doc = await uploadKnowledgeDocument(file);
      setMessage(`Ingested ${doc.filename} — ${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} embedded.`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  async function remove(doc: KnowledgeDocument) {
    if (!window.confirm(`Delete "${doc.filename}" and its ${doc.chunkCount} embedded chunks? The agent will stop retrieving from it.`)) {
      return;
    }
    setActionError('');
    setMessage('');
    try {
      await deleteKnowledgeDocument(doc.id);
      setMessage(`Deleted ${doc.filename}.`);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Delete failed.');
    }
  }

  const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunkCount ?? 0), 0);

  return (
    <section className="admin-users-panel">
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {actionError && <PageAlert message={actionError} tone="error" onDismiss={() => setActionError('')} />}

      <header className="pipeline-console-header">
        <div>
          <h2>Knowledge Base</h2>
          <p className="dash-muted">
            Documents the AI agent retrieves from on every run. Text is chunked, embedded, and stored as vectors
            in the agent service&rsquo;s Postgres. PDF, Markdown, and text files up to 6&nbsp;MB.
          </p>
        </div>
        <div className="pipeline-header-badges">
          <span className="pipeline-badge">{documents.length} docs</span>
          <span className="pipeline-badge">{totalChunks} chunks</span>
          <button className="pipeline-icon-action" disabled={isLoading} onClick={() => void refresh()} title="Refresh" type="button">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <div className="dash-form-row" style={{ margin: '12px 0' }}>
        <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={onFilePicked} hidden />
        <button
          className="dash-primary-action"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <UploadCloud size={15} />
          {isUploading ? 'Ingesting…' : 'Upload document'}
        </button>
      </div>

      {loadError && <PageAlert message={loadError} tone="error" onDismiss={() => setLoadError('')} />}

      {documents.length === 0 && !isLoading && !loadError ? (
        <EmptyState>No documents yet — upload a PDF or Markdown file to give the agent reference knowledge.</EmptyState>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Size</th>
                <th>Chunks</th>
                <th>Status</th>
                <th>Added</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    {doc.filename}
                  </td>
                  <td>{formatBytes(doc.byteSize)}</td>
                  <td>{doc.chunkCount}</td>
                  <td>
                    <span className={`pipeline-badge ${doc.status === 'failed' ? 'pipeline-badge--warning' : ''}`} title={doc.error ?? ''}>
                      {doc.status}
                    </span>
                  </td>
                  <td>{new Date(doc.createdAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="pipeline-icon-action" onClick={() => void remove(doc)} title="Delete document" type="button">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
