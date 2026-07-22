import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, Eye, Rocket, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listAwsAccounts, type AwsAccountRecord } from '../dashboard/awsApi';
import { getStoredUser } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';
import { createDeploymentPlan } from '../utils/deploymentPlan';
import { createCanvasDeployment, forceDestroyDeployment, getDeployment, type DeploymentRecord } from '../utils/deploymentApi';
import { exportTerraform } from '../utils/exportTerraform';
import { buildDeploymentResourceBundle, downloadJsonFile } from '../utils/resourceRequirements';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import type { ValidationIssue } from '../utils/validate';
import { validateServiceAccess } from '../utils/accessControl';

type DeploymentStatus = 'idle' | 'running' | 'success' | 'error' | 'destroyed';
type RunnerLog = DeploymentRecord['logs'][number];
const STUCK_DEPLOYMENT_THRESHOLD_MS = 5 * 60 * 1000;
const FORCE_DESTROY_ELIGIBLE_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying', 'destroying'];

type DeploymentModalProps = {
  nodes: AwsNode[];
  edges: AwsEdge[];
  issues: ValidationIssue[];
  onClose: () => void;
  onValidate: () => ValidationIssue[];
};

function DeploymentModal({ nodes, edges, issues, onClose, onValidate }: DeploymentModalProps) {
  const user = getStoredUser();
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>('idle');
  const [currentIssues, setCurrentIssues] = useState(issues);
  const [accounts, setAccounts] = useState<AwsAccountRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [queuedDeployment, setQueuedDeployment] = useState<DeploymentRecord | null>(null);
  const [showDeploymentSuccess, setShowDeploymentSuccess] = useState(false);
  const [isConfirmingForceDestroy, setIsConfirmingForceDestroy] = useState(false);
  const [isForceDestroying, setIsForceDestroying] = useState(false);
  const [forceDestroyError, setForceDestroyError] = useState('');
  const elapsedRunningMs = queuedDeployment?.startedAt ? Math.max(0, Date.now() - new Date(queuedDeployment.startedAt).getTime()) : 0;
  const isTakingUnusuallyLong =
    deploymentStatus === 'running' && Boolean(queuedDeployment) && FORCE_DESTROY_ELIGIBLE_STATUSES.includes(queuedDeployment!.status) && elapsedRunningMs >= STUCK_DEPLOYMENT_THRESHOLD_MS;
  const terraform = useMemo(() => exportTerraform(nodes, edges), [edges, nodes]);
  const terraformIssues = useMemo(() => validateGeneratedTerraform(terraform), [terraform]);
  const accessIssues = useMemo(() => validateServiceAccess(nodes, user), [nodes, user]);
  const effectiveIssues = useMemo(() => [...currentIssues, ...terraformIssues, ...accessIssues], [accessIssues, currentIssues, terraformIssues]);
  const plan = useMemo(() => createDeploymentPlan(nodes, edges, effectiveIssues), [effectiveIssues, edges, nodes]);
  const resourceBundle = useMemo(
    () => buildDeploymentResourceBundle(nodes, edges, effectiveIssues, queuedDeployment?.outputs),
    [effectiveIssues, edges, nodes, queuedDeployment?.outputs],
  );
  const connectedAccounts = accounts.filter((account) => account.status === 'connected');
  const selectedAccount = connectedAccounts.find((account) => account._id === selectedAccountId);
  const canDeploy = plan.resourceCount > 0 && plan.blockers === 0 && Boolean(selectedAccountId);
  const isAlreadyDeployed = deploymentStatus === 'success' || queuedDeployment?.status === 'deployed';
  const runnerLogs = useMemo(() => {
    const logs = queuedDeployment?.logs ?? [];
    const statusLog: RunnerLog[] = queuedDeployment
      ? [
          {
            level: queuedDeployment.status === 'failed' ? 'error' : 'info',
            message: `Deployment ${queuedDeployment._id} is ${queuedDeployment.status}.`,
          },
        ]
      : [];
    const errorLog: RunnerLog[] = requestError
      ? [
          {
            level: 'error',
            message: requestError,
          },
        ]
      : [];
    return [...statusLog, ...logs, ...errorLog];
  }, [queuedDeployment, requestError]);

  useEffect(() => {
    let isMounted = true;

    listAwsAccounts()
      .then((data) => {
        if (!isMounted) return;
        setAccounts(data);
        const firstConnected = data.find((account) => account.status === 'connected');
        setSelectedAccountId(firstConnected?._id ?? '');
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setRequestError(error instanceof Error ? error.message : 'Could not load connected AWS accounts.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingAccounts(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!queuedDeployment?._id || !['queued', 'deploying', 'destroying'].includes(queuedDeployment.status)) return;

    const timer = window.setInterval(() => {
      getDeployment(queuedDeployment._id)
        .then((deployment) => {
          setQueuedDeployment(deployment);
          if (deployment.status === 'deployed') setDeploymentStatus('success');
          if (deployment.status === 'failed') {
            setDeploymentStatus('error');
            setRequestError(deployment.logs[deployment.logs.length - 1]?.message ?? 'Deployment failed.');
          }
          if (deployment.status === 'destroyed' || deployment.status === 'cancelled') {
            setDeploymentStatus('destroyed');
          }
        })
        .catch((error: unknown) => {
          setDeploymentStatus('error');
          setRequestError(error instanceof Error ? error.message : 'Could not refresh deployment status.');
        });
    }, 2200);

    return () => window.clearInterval(timer);
  }, [queuedDeployment?._id, queuedDeployment?.status]);

  async function confirmForceDestroy() {
    if (!queuedDeployment?._id) return;
    setIsForceDestroying(true);
    setForceDestroyError('');
    try {
      const updated = await forceDestroyDeployment(queuedDeployment._id);
      setQueuedDeployment(updated);
      setIsConfirmingForceDestroy(false);
    } catch (error) {
      setForceDestroyError(error instanceof Error ? error.message : 'Unable to force destroy this deployment.');
    } finally {
      setIsForceDestroying(false);
    }
  }

  useEffect(() => {
    if (deploymentStatus === 'success') setShowDeploymentSuccess(true);
  }, [deploymentStatus]);

  function rerunValidation() {
    setCurrentIssues(onValidate());
  }

  function copyTerraform() {
    void navigator.clipboard?.writeText(terraform);
  }

  function downloadPlan() {
    downloadJsonFile('deployment-plan.json', { plan, terraform, nodes, edges, validationIssues: effectiveIssues, resourceInfo: resourceBundle });
  }

  function downloadResourceInfo() {
    downloadJsonFile('deployment-resource-info.json', resourceBundle);
  }

  function goToResourceInfoPage() {
    if (!queuedDeployment) return;
    window.location.href = `/dashboard?view=resource-info&deployment=${encodeURIComponent(queuedDeployment._id)}`;
  }

  async function deployToAws() {
    if (!canDeploy || !selectedAccount || isAlreadyDeployed) return;

    const latestIssues = onValidate();
    const latestTerraformIssues = validateGeneratedTerraform(exportTerraform(nodes, edges));
    const latestAccessIssues = validateServiceAccess(nodes, user);
    const latestEffectiveIssues = [...latestIssues, ...latestTerraformIssues, ...latestAccessIssues];
    setCurrentIssues(latestIssues);
    if (latestEffectiveIssues.some((issue) => issue.severity === 'error')) {
      setRequestError('Deployment blocked. Fix all required resource fields and validation errors, then retry.');
      return;
    }

    setDeploymentStatus('running');
    setRequestError('');
    setQueuedDeployment(null);
    setShowDeploymentSuccess(false);

    try {
      const deployment = await createCanvasDeployment({
        name: plan.name,
        awsAccountId: selectedAccount._id,
        activeRegion: plan.regions[0] ?? selectedAccount.defaultRegion,
        nodes,
        edges,
        autoApply: true,
      });
      setQueuedDeployment(deployment);
      setDeploymentStatus(['deployed'].includes(deployment.status) ? 'success' : 'running');
    } catch (error) {
      setDeploymentStatus('error');
      setRequestError(error instanceof Error ? error.message : 'Deployment request failed.');
    }
  }

  return (
    <>
    <section className="deployment-page">
      <header className="deployment-modal__header">
        <div>
          <span>Deploy drawn infrastructure</span>
          <h3>{plan.name}</h3>
        </div>
        <button className="text-button" onClick={onClose}>
          <ArrowLeft size={16} />
          Back to builder
        </button>
      </header>

      <section className="deployment-summary">
        <div>
          <strong>{plan.resourceCount}</strong>
          <span>Resources</span>
        </div>
        <div>
          <strong>{plan.connectionCount}</strong>
          <span>Connections</span>
        </div>
        <div>
          <strong>{plan.regions.join(', ')}</strong>
          <span>Target region</span>
        </div>
        <div>
          <strong>{plan.warnings}</strong>
          <span>Warnings</span>
        </div>
      </section>

      {isTakingUnusuallyLong && (
        <div className="deployment-stuck-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>This deployment has been running for {formatElapsedMinutes(elapsedRunningMs)}.</strong>
            <p>
              If it looks stuck, force destroy will clean up any AWS resources already created for it instead of leaving orphaned, still-billing infrastructure behind.
            </p>
          </div>
          {isConfirmingForceDestroy ? (
            <div className="deployment-stuck-warning__confirm">
              <span>Force destroy now?</span>
              <button className="text-button" disabled={isForceDestroying} onClick={() => setIsConfirmingForceDestroy(false)} type="button">
                Cancel
              </button>
              <button className="deployment-force-destroy-button" disabled={isForceDestroying} onClick={() => void confirmForceDestroy()} type="button">
                {isForceDestroying ? 'Forcing...' : 'Yes, force destroy'}
              </button>
            </div>
          ) : (
            <button className="deployment-force-destroy-button" onClick={() => setIsConfirmingForceDestroy(true)} type="button">
              <AlertTriangle size={14} />
              Force destroy
            </button>
          )}
          {forceDestroyError && <p className="deployment-stuck-warning__error">{forceDestroyError}</p>}
        </div>
      )}

      <div className="deployment-page__actions">
        <button className="text-button" onClick={rerunValidation}>
          Re-run validation
        </button>
        <button className="text-button" onClick={copyTerraform}>
          <Copy size={16} />
          Copy Terraform
        </button>
        <button className="text-button" onClick={downloadPlan}>
          <Download size={16} />
          Download Plan
        </button>
        <button className="text-button" onClick={downloadResourceInfo}>
          <Download size={16} />
          Download Resource Info
        </button>
        <button className="text-button" disabled={!queuedDeployment} onClick={goToResourceInfoPage}>
          <Eye size={16} />
          View Resource Info
        </button>
        <button className="deployment-primary" disabled={!canDeploy || deploymentStatus === 'running' || isAlreadyDeployed} onClick={deployToAws}>
          <Rocket size={16} />
          {deploymentStatus === 'running' ? 'Deploying...' : deploymentStatus === 'success' ? 'Deployed' : 'Deploy to AWS'}
        </button>
      </div>

      <div className="deployment-page__body">
        <section className="deployment-panel deployment-log-panel deployment-log-panel--primary">
          <div className="deployment-panel__title">Terraform runner logs</div>
          {runnerLogs.length ? (
            <div className="deployment-log-list">
              {runnerLogs.map((log, index) => (
                <div className={`deployment-log-line deployment-log-line--${deploymentLogLevel(log)}`} key={`${log.at ?? index}-${log.message}`}>
                  <span>{deploymentLogLevel(log)}</span>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="deployment-log-empty">
              This area will show Terraform init, plan, and apply output after deployment starts.
            </div>
          )}
        </section>

        <aside className="deployment-page__side">
          <section className="deployment-panel deployment-target">
            <div className="deployment-panel__title">AWS deployment target</div>
            <label>
              <span>Connected account</span>
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={isLoadingAccounts || deploymentStatus === 'running'}
            >
              <option value="">{isLoadingAccounts ? 'Loading accounts...' : 'Select AWS account'}</option>
              {connectedAccounts.map((account) => (
                <option value={account._id} key={account._id}>
                  {account.name} - {account.accountId} ({account.defaultRegion})
                </option>
              ))}
            </select>
          </label>
          {!isLoadingAccounts && connectedAccounts.length === 0 && (
            <p className="deployment-note">Connect an AWS account from the dashboard before deploying infrastructure.</p>
          )}
          </section>

          <section className="deployment-panel">
            <div className="deployment-panel__title">Deployment checks</div>
            <div className="deployment-steps">
              {plan.steps.map((step) => (
                <div className={`deployment-step deployment-step--${step.status}`} key={step.label}>
                  {step.status === 'blocked' ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                  <span>{step.label}</span>
                  <em>{step.status}</em>
                </div>
              ))}
            </div>
            {effectiveIssues.length > 0 && (
              <div className="deployment-issues">
                {effectiveIssues.map((issue) => (
                  <div key={`${issue.nodeId ?? issue.edgeId}-${issue.message}`}>{issue.message}</div>
                ))}
              </div>
            )}
          </section>

          <section className="deployment-panel">
            <div className="deployment-panel__title">Terraform preview</div>
            <pre className="deployment-code">{terraform}</pre>
          </section>
        </aside>
      </div>
    </section>
    {showDeploymentSuccess && (
      <div className="deployment-success-backdrop" role="presentation" onClick={() => setShowDeploymentSuccess(false)}>
        <section className="deployment-success-popup" role="dialog" aria-modal="true" aria-labelledby="deployment-success-title" onClick={(event) => event.stopPropagation()}>
          <span className="deployment-success-icon">
            <CheckCircle2 size={28} />
          </span>
          <h2 id="deployment-success-title">Your resource has been deployed</h2>
          <p>AWS deployment completed successfully. The created resource should now be visible in the target AWS account.</p>
          <button className="text-button" type="button" onClick={goToResourceInfoPage}>
            <Eye size={16} />
            View resource info
          </button>
          <button className="text-button" type="button" onClick={downloadResourceInfo}>
            <Download size={16} />
            Download one-time resource info
          </button>
          <button className="deployment-primary" type="button" onClick={() => setShowDeploymentSuccess(false)}>
            Continue
          </button>
        </section>
      </div>
    )}
    </>
  );
}

function formatElapsedMinutes(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function deploymentLogLevel(log: RunnerLog): 'error' | 'warning' | 'info' {
  const level = String(log.level ?? '').toLowerCase();
  const message = String(log.message ?? '').toLowerCase();
  if (level.includes('error') || message.includes('error:') || message.includes('accessdenied') || message.includes('unauthorizedoperation') || message.includes('failed')) return 'error';
  if (level.includes('warn')) return 'warning';
  return 'info';
}

export default DeploymentModal;
