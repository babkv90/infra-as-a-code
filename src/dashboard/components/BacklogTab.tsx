import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { PageAlert } from '../../components/PageAlert';
import { EmptyState } from './DashPrimitives';
import {
  BACKLOG_SEVERITIES,
  BACKLOG_STATUSES,
  createBacklogItem,
  listBacklog,
  listChangeLog,
  updateBacklogItem,
  type BacklogItem,
  type BacklogSeverity,
  type BacklogStatus,
  type ChangeLogEntry,
} from '../superAdminApi';

const STATUS_LABEL: Record<BacklogStatus, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  resolved: 'Resolved',
  wontfix: "Won't fix",
};

export function BacklogTab() {
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [changeEntries, setChangeEntries] = useState<ChangeLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<BacklogSeverity>('medium');
  const [status, setStatus] = useState<BacklogStatus>('open');
  const [targetPhase, setTargetPhase] = useState('');
  const [identifiedDuring, setIdentifiedDuring] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{ title?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<'all' | BacklogSeverity>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | BacklogStatus>('all');

  async function refresh() {
    setIsLoading(true);
    try {
      const [backlog, changeLog] = await Promise.all([listBacklog(), listChangeLog()]);
      setItems(backlog.items);
      setChangeEntries(changeLog.entries);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load backlog.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function validate() {
    const errors: typeof fieldErrors = {};
    if (!title.trim()) errors.title = 'A short title is required.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError('');
    setMessage('');
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await createBacklogItem({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        status,
        targetPhase: targetPhase.trim() || undefined,
        identifiedDuring: identifiedDuring || undefined,
      });
      setTitle('');
      setDescription('');
      setSeverity('medium');
      setStatus('open');
      setTargetPhase('');
      setIdentifiedDuring('');
      setFieldErrors({});
      setMessage('Backlog item added.');
      await refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to add backlog item.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeStatus(item: BacklogItem, next: BacklogStatus) {
    try {
      await updateBacklogItem(item.id, { status: next });
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to update item.');
    }
  }

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        return true;
      }),
    [items, severityFilter, statusFilter],
  );

  return (
    <div className="backlog-tab">
      {submitError && <PageAlert message={submitError} tone="error" onDismiss={() => setSubmitError('')} />}
      {message && <PageAlert message={message} onDismiss={() => setMessage('')} />}
      {loadError && <PageAlert message={loadError} tone="error" onDismiss={() => setLoadError('')} />}
      <div className="backlog-grid">
        <form className="backlog-form" onSubmit={submit}>
          <header>
            <strong>Add backlog item</strong>
            <span>Track technical debt and follow-ups.</span>
          </header>

          <Field label="Title" required error={fieldErrors.title}>
            <input maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. verifyDeploymentResources is not executor-aware" value={title} />
          </Field>

          <Field label="Description">
            <textarea onChange={(event) => setDescription(event.target.value)} placeholder="Details, context, acceptance criteria" rows={3} value={description} />
          </Field>

          <div className="backlog-form-row">
            <Field label="Severity" required>
              <select onChange={(event) => setSeverity(event.target.value as BacklogSeverity)} value={severity}>
                {BACKLOG_SEVERITIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Status" required>
              <select onChange={(event) => setStatus(event.target.value as BacklogStatus)} value={status}>
                {BACKLOG_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABEL[option]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Target phase">
            <input onChange={(event) => setTargetPhase(event.target.value)} placeholder="e.g. before scale-up, next sprint" value={targetPhase} />
          </Field>

          <Field label="Identified during (optional)">
            <select onChange={(event) => setIdentifiedDuring(event.target.value)} value={identifiedDuring}>
              <option value="">Not linked to a change</option>
              {changeEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </Field>

          <button className="pipeline-primary-compact" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Adding…' : 'Add item'}
          </button>
        </form>

        <section className="backlog-list-panel">
          <header>
            <div className="backlog-list-title">
              <strong>Technical backlog</strong>
              <span>
                {filtered.length} of {items.length} shown
              </span>
            </div>
            <div className="backlog-filters">
              <select onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)} value={severityFilter}>
                <option value="all">All severities</option>
                {BACKLOG_SEVERITIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}>
                <option value="all">All statuses</option>
                {BACKLOG_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
          </header>

          <div className="backlog-table-wrap">
            <table className="backlog-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Target phase</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr className={item.status === 'resolved' || item.status === 'wontfix' ? 'is-closed' : ''} key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      {item.description && <span>{item.description}</span>}
                      {item.identifiedDuring && typeof item.identifiedDuring !== 'string' && (
                        <em className="backlog-origin">from: {item.identifiedDuring.title}</em>
                      )}
                    </td>
                    <td>
                      <span className={`backlog-sev backlog-sev--${item.severity}`}>{item.severity}</span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select
                        className={`backlog-status-select backlog-status-select--${item.status}`}
                        onChange={(event) => void changeStatus(item, event.target.value as BacklogStatus)}
                        value={item.status}
                      >
                        {BACKLOG_STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {STATUS_LABEL[option]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{item.targetPhase || '—'}</td>
                    <td>
                      {item.status !== 'resolved' ? (
                        <button className="backlog-resolve-btn" onClick={() => void changeStatus(item, 'resolved')} type="button">
                          Mark resolved
                        </button>
                      ) : (
                        <span className="backlog-resolved-tag">Resolved</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isLoading && !items.length ? (
              <EmptyState>Loading backlog…</EmptyState>
            ) : (
              !filtered.length && <EmptyState>No backlog items match these filters.</EmptyState>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Same markup/classes as PropertiesPanel.tsx's Field helper (not exported there) — reused so backlog
// forms share the app's inline required/error styling.
function Field({ label, children, required, error }: { label: string; children: React.ReactNode; required?: boolean; error?: string }) {
  return (
    <label className={`field ${error ? 'field--error' : ''}`}>
      <span>
        {label}
        {required && <em>Required</em>}
      </span>
      {children}
      {error && <small>{error}</small>}
    </label>
  );
}
