import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Download, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '../utils/apiClient';
import { buildDeploymentResourceBundle, downloadJsonFile } from '../utils/resourceRequirements';
import { isSecretPlaceholder } from '../utils/secretPlaceholder';

export type ResourceBundle = ReturnType<typeof buildDeploymentResourceBundle>;

type ResourceInfoViewerProps = {
  bundle: ResourceBundle;
  fileName?: string;
};

function ResourceInfoViewer({ bundle, fileName = 'deployment-resource-info.json' }: ResourceInfoViewerProps) {
  const [copiedKey, setCopiedKey] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [collapsedResources, setCollapsedResources] = useState<Set<string>>(new Set());

  // Sensitive "Live outputs" fields never arrive with a real value (see secretRedaction.js on the
  // backend) — only a { revealPath } marker. These three pieces of state back the broker-backed
  // reveal flow: the fetched value (cached so a second reveal/copy doesn't re-hit the network), which
  // fields are currently shown un-masked, and any fetch error to surface inline instead of crashing.
  const [outputSecretValues, setOutputSecretValues] = useState<Record<string, string>>({});
  const [outputSecretVisible, setOutputSecretVisible] = useState<Set<string>>(new Set());
  const [outputSecretLoading, setOutputSecretLoading] = useState<Set<string>>(new Set());
  const [outputSecretErrors, setOutputSecretErrors] = useState<Record<string, string>>({});

  function copyValue(key: string, value: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? '' : current)), 1500);
    });
  }

  function toggleReveal(key: string) {
    setRevealedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Calls the reveal broker endpoint (GET /deployments/:id/secrets/output/:resourceKey/:fieldKey) —
  // the only place the real value ever appears in a network response. Caches the result per fieldKey
  // so toggling reveal off/on or copying afterward doesn't re-fetch.
  async function fetchOutputSecret(fieldKey: string, revealPath: string): Promise<string | undefined> {
    if (outputSecretValues[fieldKey] !== undefined) return outputSecretValues[fieldKey];
    setOutputSecretLoading((current) => new Set(current).add(fieldKey));
    setOutputSecretErrors((current) => {
      if (!(fieldKey in current)) return current;
      const next = { ...current };
      delete next[fieldKey];
      return next;
    });
    try {
      const { value } = await apiRequest<{ value: string }>(revealPath);
      setOutputSecretValues((current) => ({ ...current, [fieldKey]: value }));
      return value;
    } catch (error) {
      setOutputSecretErrors((current) => ({
        ...current,
        [fieldKey]: error instanceof Error ? error.message : 'Could not load this value.',
      }));
      return undefined;
    } finally {
      setOutputSecretLoading((current) => {
        const next = new Set(current);
        next.delete(fieldKey);
        return next;
      });
    }
  }

  async function toggleRevealOutputSecret(fieldKey: string, revealPath: string | null) {
    if (outputSecretVisible.has(fieldKey)) {
      setOutputSecretVisible((current) => {
        const next = new Set(current);
        next.delete(fieldKey);
        return next;
      });
      return;
    }
    if (!revealPath) return;
    const value = await fetchOutputSecret(fieldKey, revealPath);
    if (value !== undefined) setOutputSecretVisible((current) => new Set(current).add(fieldKey));
  }

  // Copies the real value without requiring it to ever be shown on screen — fetches (or reuses the
  // cached fetch) then copies, independent of outputSecretVisible.
  async function copyOutputSecret(fieldKey: string, revealPath: string | null) {
    if (!revealPath) return;
    const value = await fetchOutputSecret(fieldKey, revealPath);
    if (value !== undefined) copyValue(fieldKey, value);
  }

  function toggleCollapse(nodeId: string) {
    setCollapsedResources((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <div className="resource-info">
      <header className="resource-info__header">
        <div>
          <strong>Deployment resource info</strong>
          <span>Generated {new Date(bundle.generatedAt).toLocaleString()}</span>
        </div>
        <div className="resource-info__summary">
          <span>{bundle.summary.resources} resources</span>
          <span>{bundle.summary.connections} connections</span>
          {bundle.summary.errors > 0 && <span className="resource-info__summary-error">{bundle.summary.errors} errors</span>}
          {bundle.summary.warnings > 0 && <span className="resource-info__summary-warning">{bundle.summary.warnings} warnings</span>}
        </div>
        <button className="resource-info__download-button" onClick={() => downloadJsonFile(fileName, bundle)} type="button">
          <Download size={13} />
          Download JSON
        </button>
      </header>

      <p className="resource-info__warning">{bundle.warning}</p>

      <div className="resource-info__resources">
        {bundle.resources.map((resource) => {
          const outputGroup = matchOutputGroup(bundle.terraformOutputs, resource.label);
          const isCollapsed = collapsedResources.has(resource.nodeId);
          const configuredKeys = resource.validKeys.filter((field) => hasValue(field.value));

          return (
            <section className="resource-info-card" key={resource.nodeId}>
              <button className="resource-info-card__header" onClick={() => toggleCollapse(resource.nodeId)} type="button">
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <div>
                  <strong>{resource.label}</strong>
                  <span>
                    {resource.serviceName} &middot; {resource.terraformType}
                  </span>
                </div>
                {resource.missingRequiredKeys.length > 0 && <em className="resource-info-card__flag">{resource.missingRequiredKeys.length} missing</em>}
              </button>

              {!isCollapsed && (
                <div className="resource-info-card__body">
                  {resource.arn && (
                    <div className="resource-info-card__group">
                      <span className="resource-info-card__group-title">Identity</span>
                      <CopyableRow copiedKey={copiedKey} fieldKey={`${resource.nodeId}-arn`} label="ARN" onCopy={copyValue} value={resource.arn} />
                    </div>
                  )}

                  <div className="resource-info-card__group">
                    <span className="resource-info-card__group-title">Live outputs</span>
                    {resource.expectedOutputs.length ? (
                      resource.expectedOutputs.map((outputKey) => {
                        const cell = outputGroup?.[outputKey];
                        const fieldKey = `${resource.nodeId}-out-${outputKey}`;

                        if (isSecretPlaceholder(cell)) {
                          const revealPath = cell.revealPath;
                          const isVisible = outputSecretVisible.has(fieldKey);
                          const revealedValue = outputSecretValues[fieldKey];
                          return (
                            <CopyableRow
                              copiedKey={copiedKey}
                              disabledReason={!revealPath ? "This deployment's secrets haven't been migrated to the vault yet — ask an admin to run the migration script." : undefined}
                              error={outputSecretErrors[fieldKey]}
                              fieldKey={fieldKey}
                              key={outputKey}
                              label={outputKey}
                              loading={outputSecretLoading.has(fieldKey)}
                              onCopy={() => void copyOutputSecret(fieldKey, revealPath)}
                              onToggleReveal={() => void toggleRevealOutputSecret(fieldKey, revealPath)}
                              revealed={isVisible}
                              secret
                              value={isVisible && revealedValue !== undefined ? revealedValue : ''}
                            />
                          );
                        }

                        const value = cell === undefined || cell === null ? '' : String(cell);
                        const isSecret = isSecretKey(outputKey);
                        return (
                          <CopyableRow
                            copiedKey={copiedKey}
                            fieldKey={fieldKey}
                            key={outputKey}
                            label={outputKey}
                            onCopy={copyValue}
                            onToggleReveal={isSecret && value ? () => toggleReveal(fieldKey) : undefined}
                            pending={!value}
                            revealed={revealedKeys.has(fieldKey)}
                            secret={isSecret}
                            value={value || 'Not available until deploy completes'}
                          />
                        );
                      })
                    ) : (
                      <p className="resource-info-card__empty">No outputs expected for this resource type.</p>
                    )}
                  </div>

                  {configuredKeys.length > 0 && (
                    <div className="resource-info-card__group">
                      <span className="resource-info-card__group-title">Configuration used</span>
                      {configuredKeys.map((field) => {
                        const isSecret = resource.sensitiveKeys.includes(field.key);
                        const fieldKey = `${resource.nodeId}-cfg-${field.key}`;
                        return (
                          <CopyableRow
                            copiedKey={copiedKey}
                            fieldKey={fieldKey}
                            key={field.key}
                            label={field.label}
                            onCopy={copyValue}
                            onToggleReveal={isSecret ? () => toggleReveal(fieldKey) : undefined}
                            revealed={revealedKeys.has(fieldKey)}
                            secret={isSecret}
                            value={String(field.value)}
                          />
                        );
                      })}
                    </div>
                  )}

                  {resource.missingRequiredKeys.length > 0 && (
                    <div className="resource-info-card__group">
                      <span className="resource-info-card__group-title resource-info-card__group-title--warning">Missing required fields</span>
                      <p className="resource-info-card__empty">{resource.missingRequiredKeys.join(', ')}</p>
                    </div>
                  )}

                  {resource.connectivity.length > 0 && (
                    <div className="resource-info-card__group">
                      <span className="resource-info-card__group-title">Notes</span>
                      <ul className="resource-info-card__notes">
                        {resource.connectivity.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {!bundle.resources.length && <p className="resource-info__empty">No AWS service resources found on this diagram.</p>}
      </div>

      {bundle.connections.length > 0 && (
        <section className="resource-info-section">
          <span className="resource-info-section__title">Connections</span>
          <ul className="resource-info__connections">
            {bundle.connections.map((connection) => (
              <li key={connection.id}>
                <strong>{connection.source}</strong> &rarr; <strong>{connection.target}</strong>
                <span>
                  {connection.type}
                  {connection.protocol ? `, ${connection.protocol}` : ''}
                  {connection.port ? `:${connection.port}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {bundle.validationIssues.length > 0 && (
        <section className="resource-info-section">
          <span className="resource-info-section__title">Validation notes</span>
          <ul className="resource-info__issues">
            {bundle.validationIssues.map((issue, index) => (
              <li className={`resource-info__issue resource-info__issue--${issue.severity}`} key={`${issue.nodeId ?? issue.edgeId ?? 'issue'}-${index}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CopyableRow({
  copiedKey,
  disabledReason,
  error,
  fieldKey,
  label,
  loading,
  onCopy,
  onToggleReveal,
  pending,
  revealed,
  secret,
  value,
}: {
  copiedKey: string;
  disabledReason?: string;
  error?: string;
  fieldKey: string;
  label: string;
  loading?: boolean;
  onCopy: (key: string, value: string) => void;
  onToggleReveal?: () => void;
  pending?: boolean;
  revealed?: boolean;
  secret?: boolean;
  value: string;
}) {
  const isMasked = Boolean(secret) && !revealed && !pending;
  const displayValue = loading ? 'Loading…' : isMasked ? (value ? maskValue(value) : '••••••••••••') : value;

  return (
    <div className="resource-info-row">
      <span className="resource-info-row__label">{label}</span>
      <code className={`resource-info-row__value ${pending ? 'resource-info-row__value--pending' : ''}`}>{displayValue}</code>
      <div className="resource-info-row__actions">
        {onToggleReveal && !disabledReason && (
          <button disabled={loading} onClick={onToggleReveal} title={revealed ? 'Hide value' : 'Reveal value'} type="button">
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {disabledReason && (
          <button disabled title={disabledReason} type="button">
            <EyeOff size={13} />
          </button>
        )}
        {!pending && !disabledReason && (
          <button disabled={loading} onClick={() => onCopy(fieldKey, value)} title="Copy to clipboard" type="button">
            {copiedKey === fieldKey ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>
      {error && <span className="resource-info-row__error">{error}</span>}
    </div>
  );
}

function maskValue(value: string) {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return '*'.repeat(Math.min(value.length, 18));
}

function hasValue(value: string | number | '') {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isSecretKey(key: string) {
  return /private_key|_pem$|password|secret/i.test(key);
}

function matchOutputGroup(terraformOutputs: Record<string, unknown>, label: string) {
  const groups = Object.values(terraformOutputs ?? {});
  const match = groups.find((group) => group && typeof group === 'object' && (group as { label?: string }).label === label);
  return match as Record<string, unknown> | undefined;
}

export default ResourceInfoViewer;
