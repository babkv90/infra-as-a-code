import { ArrowLeft, CheckCircle2, Copy, Download, Rocket, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listAwsAccounts, type AwsAccountRecord } from '../dashboard/awsApi';
import type { AwsEdge, AwsNode } from '../types';
import { createDeploymentPlan } from '../utils/deploymentPlan';
import { createCanvasDeployment, getDeployment, type DeploymentRecord } from '../utils/deploymentApi';
import { exportTerraform } from '../utils/exportTerraform';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import type { ValidationIssue } from '../utils/validate';

type DeploymentStatus = 'idle' | 'running' | 'success' | 'error';
type RunnerLog = DeploymentRecord['logs'][number];

type DeploymentModalProps = {
  nodes: AwsNode[];
  edges: AwsEdge[];
  issues: ValidationIssue[];
  onClose: () => void;
  onValidate: () => ValidationIssue[];
};

function DeploymentModal({ nodes, edges, issues, onClose, onValidate }: DeploymentModalProps) {
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>('idle');
  const [currentIssues, setCurrentIssues] = useState(issues);
  const [accounts, setAccounts] = useState<AwsAccountRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [requestError, setRequestError] = useState('');
  const [queuedDeployment, setQueuedDeployment] = useState<DeploymentRecord | null>(null);
  const [showDeploymentSuccess, setShowDeploymentSuccess] = useState(false);
  const terraform = useMemo(() => exportTerraform(nodes, edges), [edges, nodes]);
  const terraformIssues = useMemo(() => validateGeneratedTerraform(terraform), [terraform]);
  const effectiveIssues = useMemo(() => [...currentIssues, ...terraformIssues], [currentIssues, terraformIssues]);
  const plan = useMemo(() => createDeploymentPlan(nodes, edges, effectiveIssues), [effectiveIssues, edges, nodes]);
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
    if (!queuedDeployment?._id || !['queued', 'deploying'].includes(queuedDeployment.status)) return;

    const timer = window.setInterval(() => {
      getDeployment(queuedDeployment._id)
        .then((deployment) => {
          setQueuedDeployment(deployment);
          if (deployment.status === 'deployed') setDeploymentStatus('success');
          if (deployment.status === 'failed') {
            setDeploymentStatus('error');
            setRequestError(deployment.logs[deployment.logs.length - 1]?.message ?? 'Deployment failed.');
          }
        })
        .catch((error: unknown) => {
          setDeploymentStatus('error');
          setRequestError(error instanceof Error ? error.message : 'Could not refresh deployment status.');
        });
    }, 2200);

    return () => window.clearInterval(timer);
  }, [queuedDeployment?._id, queuedDeployment?.status]);

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
    const content = JSON.stringify({ plan, terraform, nodes, edges, validationIssues: effectiveIssues }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'deployment-plan.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deployToAws() {
    if (!canDeploy || !selectedAccount || isAlreadyDeployed) return;

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
          <button className="deployment-primary" type="button" onClick={() => setShowDeploymentSuccess(false)}>
            Continue
          </button>
        </section>
      </div>
    )}
    </>
  );
}

function deploymentLogLevel(log: RunnerLog): 'error' | 'warning' | 'info' {
  const level = String(log.level ?? '').toLowerCase();
  const message = String(log.message ?? '').toLowerCase();
  if (level.includes('error') || message.includes('error:') || message.includes('accessdenied') || message.includes('unauthorizedoperation') || message.includes('failed')) return 'error';
  if (level.includes('warn')) return 'warning';
  return 'info';
}

export default DeploymentModal;
