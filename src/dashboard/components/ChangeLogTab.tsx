import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { EmptyState } from './DashPrimitives';
import { PerformanceChart } from './PerformanceChart';
import {
  CHANGE_DIRECTIONS,
  CHANGE_LOG_CATEGORIES,
  createChangeLogEntry,
  getPerformanceSeries,
  listBacklog,
  listChangeLog,
  type BacklogItem,
  type ChangeDirection,
  type ChangeLogCategory,
  type ChangeLogEntry,
  type PerformanceSeriesPoint,
} from '../superAdminApi';

const DIRECTION_LABEL: Record<ChangeDirection, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

export function ChangeLogTab() {
  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [backlog, setBacklog] = useState<BacklogItem[]>([]);
  const [series, setSeries] = useState<PerformanceSeriesPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ChangeLogCategory>('architecture');
  const [direction, setDirection] = useState<ChangeDirection>('positive');
  const [impactRating, setImpactRating] = useState(3);
  const [diskUsageMb, setDiskUsageMb] = useState('');
  const [linkedBacklog, setLinkedBacklog] = useState<string[]>([]);

  const [fieldErrors, setFieldErrors] = useState<{ title?: string; diskUsageMb?: string }>({});
  const [submitError, setSubmitError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function refresh() {
    setIsLoading(true);
    try {
      const [changeLog, backlogItems, perfSeries] = await Promise.all([listChangeLog(), listBacklog(), getPerformanceSeries()]);
      setEntries(changeLog.entries);
      setBacklog(backlogItems.items);
      setSeries(perfSeries.series);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load change log.');
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
    if (diskUsageMb.trim() && (!Number.isFinite(Number(diskUsageMb)) || Number(diskUsageMb) < 0)) {
      errors.diskUsageMb = 'Enter a non-negative number, or leave blank.';
    }
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
      await createChangeLogEntry({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        direction,
        impactRating,
        relatedBacklogItems: linkedBacklog.length ? linkedBacklog : undefined,
        diskUsageMb: diskUsageMb.trim() ? Number(diskUsageMb) : undefined,
      });
      setTitle('');
      setDescription('');
      setCategory('architecture');
      setDirection('positive');
      setImpactRating(3);
      setDiskUsageMb('');
      setLinkedBacklog([]);
      setFieldErrors({});
      setMessage('Change logged. Live performance metrics were captured with it.');
      await refresh();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to log this change.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleLinked(id: string) {
    setLinkedBacklog((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const openBacklog = useMemo(() => backlog.filter((item) => item.status === 'open' || item.status === 'in-progress'), [backlog]);

  return (
    <div className="changelog-tab">
      <PerformanceChart series={series} />

      <div className="changelog-grid">
        <form className="changelog-form" onSubmit={submit}>
          <header>
            <strong>Log an architecture change</strong>
            <span>Records a major change and snapshots current performance.</span>
          </header>

          <Field label="Title" required error={fieldErrors.title}>
            <input maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Migrated Terraform execution to GitHub Actions" value={title} />
          </Field>

          <Field label="Description">
            <textarea onChange={(event) => setDescription(event.target.value)} placeholder="What changed and why" rows={3} value={description} />
          </Field>

          <div className="changelog-form-row">
            <Field label="Category" required>
              <select onChange={(event) => setCategory(event.target.value as ChangeLogCategory)} value={category}>
                {CHANGE_LOG_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={`Impact rating: ${impactRating}/5`} required>
              <input max={5} min={1} onChange={(event) => setImpactRating(Number(event.target.value))} type="range" value={impactRating} />
            </Field>
          </div>

          <Field label="Direction" required>
            <div className="changelog-direction" role="radiogroup">
              {CHANGE_DIRECTIONS.map((option) => (
                <button
                  className={`changelog-direction-btn changelog-direction-btn--${option} ${direction === option ? 'is-active' : ''}`}
                  key={option}
                  onClick={() => setDirection(option)}
                  role="radio"
                  aria-checked={direction === option}
                  type="button"
                >
                  {DIRECTION_LABEL[option]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Disk usage (MB)" error={fieldErrors.diskUsageMb}>
            <input onChange={(event) => setDiskUsageMb(event.target.value)} placeholder="Optional — no live source for this" value={diskUsageMb} />
          </Field>

          {openBacklog.length > 0 && (
            <Field label="Link backlog items (optional)">
              <div className="changelog-link-list">
                {openBacklog.map((item) => (
                  <label className="changelog-link-item" key={item.id}>
                    <input checked={linkedBacklog.includes(item.id)} onChange={() => toggleLinked(item.id)} type="checkbox" />
                    <span>
                      <span className={`backlog-sev backlog-sev--${item.severity}`}>{item.severity}</span>
                      {item.title}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}

          {submitError && <div className="pipeline-notice pipeline-notice--error">{submitError}</div>}
          {message && <div className="pipeline-notice">{message}</div>}

          <button className="pipeline-primary-compact" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Logging…' : 'Log change'}
          </button>
        </form>

        <section className="changelog-list-panel">
          <header>
            <strong>Change history</strong>
            <span>{entries.length} entries</span>
          </header>
          {loadError && <div className="pipeline-notice pipeline-notice--error">{loadError}</div>}
          {isLoading && !entries.length ? (
            <EmptyState>Loading change log…</EmptyState>
          ) : entries.length ? (
            <ol className="changelog-list">
              {entries.map((entry) => (
                <li className={`changelog-entry changelog-entry--${entry.direction}`} key={entry.id}>
                  <div className="changelog-entry-head">
                    <span className={`changelog-dir-pill changelog-dir-pill--${entry.direction}`}>{DIRECTION_LABEL[entry.direction]}</span>
                    <strong>{entry.title}</strong>
                    <span className="changelog-impact" title="Impact rating">
                      {'●'.repeat(entry.impactRating)}
                      <span className="changelog-impact-dim">{'●'.repeat(5 - entry.impactRating)}</span>
                    </span>
                  </div>
                  <div className="changelog-entry-meta">
                    <span className="changelog-cat">{entry.category}</span>
                    <span>{entry.occurredAt ? new Date(entry.occurredAt).toLocaleDateString() : ''}</span>
                    {entry.author && <span>by {entry.author.name}</span>}
                  </div>
                  {entry.description && <p className="changelog-desc">{entry.description}</p>}
                  {entry.performanceSnapshot && <SnapshotStrip snapshot={entry.performanceSnapshot} />}
                  {entry.relatedBacklogItems.length > 0 && (
                    <div className="changelog-linked">
                      {entry.relatedBacklogItems.map((item) =>
                        typeof item === 'string' ? null : (
                          <span className={`backlog-sev backlog-sev--${item.severity}`} key={item.id}>
                            {item.title}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState>No changes logged yet. Use the form to record the first one.</EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

function SnapshotStrip({ snapshot }: { snapshot: ChangeLogEntry['performanceSnapshot'] }) {
  if (!snapshot) return null;
  const items: string[] = [];
  if (typeof snapshot.deploymentSuccessRate === 'number') items.push(`${snapshot.deploymentSuccessRate}% success`);
  if (typeof snapshot.avgDeployTimeSec === 'number') items.push(`${snapshot.avgDeployTimeSec}s avg deploy`);
  if (typeof snapshot.totalDeployments === 'number') items.push(`${snapshot.totalDeployments} deployments`);
  if (typeof snapshot.diskUsageMb === 'number') items.push(`${snapshot.diskUsageMb} MB disk`);
  if (!items.length) return null;
  return (
    <div className="changelog-snapshot">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

// Same markup/classes as the Field helper in PropertiesPanel.tsx (which isn't exported) — reused here
// so change-log forms share the app's inline required/error styling rather than a new one.
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

