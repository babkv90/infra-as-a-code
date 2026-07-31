import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Code2, Copy, Download, ExternalLink, Eye, Loader2, Rocket, ScrollText, Save, ShieldAlert, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listAwsAccounts, type AwsAccountRecord } from '../dashboard/awsApi';
import { getStoredUser } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';
import { createDeploymentPlan } from '../utils/deploymentPlan';
import { useDeploymentMonitorStore } from '../store/deploymentMonitorStore';
import {
  createCanvasDeployment,
  forceDestroyDeployment,
  getDeployment,
  getDeploymentGithubRun,
  getDeploymentGithubRunJobLogs,
  mergeDeployment,
  updateDeployment,
  type DeploymentRecord,
  type GithubRunStatus,
} from '../utils/deploymentApi';
import { exportTerraform } from '../utils/exportTerraform';
import { buildDeploymentResourceBundle, downloadJsonFile } from '../utils/resourceRequirements';
import { validateGeneratedTerraform } from '../utils/terraformValidation';
import type { ValidationIssue } from '../utils/validate';
import { validateServiceAccess } from '../utils/accessControl';

type DeploymentStatus = 'idle' | 'running' | 'success' | 'error' | 'destroyed';
type RunnerLog = DeploymentRecord['logs'][number];
const STUCK_DEPLOYMENT_THRESHOLD_MS = 5 * 60 * 1000;
const FORCE_DESTROY_ELIGIBLE_STATUSES: DeploymentRecord['status'][] = ['queued', 'deploying', 'destroying'];
const GITHUB_ACTIVE_RUN_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
const GITHUB_LOG_POLL_MS = 3000;

type DeploymentModalProps = {
  nodes: AwsNode[];
  edges: AwsEdge[];
  issues: ValidationIssue[];
  onClose: () => void;
  onValidate: () => ValidationIssue[];
  updateDeploymentId?: string;
  // When set, this deploy is a MERGE: updateDeploymentId is the target deployment being merged
  // into, mergeSourceDeploymentId is the deployment whose (already id-remapped, already loaded onto
  // this canvas) nodes are being imported, and mergeImportedNodeIds identifies which of the current
  // `nodes` are the imported ones — used to require a connecting edge before allowing the merge.
  mergeSourceDeploymentId?: string;
  mergeImportedNodeIds?: string[];
  // Seeds the editable "Deployment name" field for a fresh deploy (ignored in update/merge mode,
  // where the name is already fixed to whatever the target deployment was called). Falls back to
  // the generic plan name below when not provided.
  defaultName?: string;
};

function DeploymentModal({ nodes, edges, issues, onClose, onValidate, updateDeploymentId, mergeSourceDeploymentId, mergeImportedNodeIds, defaultName }: DeploymentModalProps) {
  const user = getStoredUser();
  const isMergeMode = Boolean(mergeSourceDeploymentId);
  const isUpdateMode = Boolean(updateDeploymentId) && !isMergeMode;
  // Merges behave like updates for account-locking/"already deployed" purposes — both apply against
  // an existing deployment's Terraform state instead of creating a fresh one.
  const isUpdateLikeMode = isUpdateMode || isMergeMode;
  const watchDeployment = useDeploymentMonitorStore((state) => state.watchDeployment);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>('idle');
  const [deploymentName, setDeploymentName] = useState(() => defaultName?.trim() || 'Current visual infrastructure');
  const [isSavingDraft, setIsSavingDraft] = useState(false);
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
  const [isTerraformPreviewOpen, setIsTerraformPreviewOpen] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GithubRunStatus>();
  const [githubStatusError, setGithubStatusError] = useState('');
  const [selectedGithubJobId, setSelectedGithubJobId] = useState<number>();
  const [githubJobLogText, setGithubJobLogText] = useState('');
  const [githubJobLogError, setGithubJobLogError] = useState('');
  const [isLoadingGithubJobLog, setIsLoadingGithubJobLog] = useState(false);
  const [followGithubJobLog, setFollowGithubJobLog] = useState(true);
  const githubJobLogRef = useRef<HTMLPreElement | null>(null);
  // Captured once, at load, from the deployment's status *before* this session's edits touch it —
  // queuedDeployment.status itself moves on (queued -> deploying -> deployed/failed/destroyed again
  // as a redeploy runs), so it can't be used directly to tell "was this destroyed when I opened it."
  // Only meaningfully differs from a normal update when it's 'destroyed': Terraform is creating
  // everything fresh against an empty state, not diffing against something currently running, and
  // the UI copy below says so instead of the (here, false) "already-deployed" framing.
  const [updateOriginStatus, setUpdateOriginStatus] = useState<DeploymentRecord['status']>();
  const isRedeployFromDestroyed = isUpdateMode && updateOriginStatus === 'destroyed';
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
  const isAlreadyDeployed = !isUpdateLikeMode && (deploymentStatus === 'success' || queuedDeployment?.status === 'deployed');
  // Only a fresh deploy actually sends this name anywhere — update/merge apply against a deployment
  // that's already named, so the field (and this check) only matters outside isUpdateLikeMode.
  const isNameValid = isUpdateLikeMode || deploymentName.trim().length >= 2;
  // Saving as a draft doesn't run Terraform, so unlike canDeploy it doesn't require blockers === 0
  // — you can save a work-in-progress diagram and come back to fix validation issues before Apply.
  const canSaveDraft = !isUpdateLikeMode && plan.resourceCount > 0 && Boolean(selectedAccountId) && isNameValid;
  // A merge is only ever allowed to proceed once the imported nodes are actually wired to the
  // existing stack — mirrors the server's own strict check in mergeDeploymentFromCanvas so the user
  // gets this feedback before submitting, not just as a 409 after the fact.
  const hasMergeConnection = useMemo(() => {
    if (!isMergeMode) return true;
    const importedIds = new Set(mergeImportedNodeIds ?? []);
    if (!importedIds.size) return false;
    return edges.some((edge) => {
      if (!edge.source || !edge.target) return false;
      return importedIds.has(edge.source) !== importedIds.has(edge.target);
    });
  }, [edges, isMergeMode, mergeImportedNodeIds]);
  // Explains *why* the primary button is disabled — unlike Save as Draft (which always has a title),
  // this button previously gave no indication at all, so a disabled state just looked broken/random.
  const deployButtonDisabledReason = (() => {
    if (deploymentStatus === 'running') return undefined;
    if (plan.resourceCount === 0) return 'Add at least one AWS resource to the canvas first.';
    if (plan.blockers > 0) return 'Fix all blocking validation errors before deploying.';
    if (isMergeMode && !hasMergeConnection) return 'Draw a connection from the imported nodes to the existing infrastructure before merging.';
    if (!isNameValid) return 'Enter a deployment name (at least 2 characters).';
    if (!selectedAccountId) return 'Connect and select an AWS account first.';
    if (isAlreadyDeployed) return 'This diagram has already been deployed.';
    return undefined;
  })();
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
        if (!isUpdateLikeMode) {
          const firstConnected = data.find((account) => account.status === 'connected');
          setSelectedAccountId(firstConnected?._id ?? '');
        }
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
    if (!updateDeploymentId) return;
    let isMounted = true;

    getDeployment(updateDeploymentId)
      .then((deployment) => {
        if (!isMounted) return;
        setQueuedDeployment(deployment);
        setUpdateOriginStatus(deployment.status);
        if (deployment.awsAccount) setSelectedAccountId(deployment.awsAccount);
        if (['queued', 'deploying'].includes(deployment.status)) watchDeployment(deployment._id);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setRequestError(error instanceof Error ? error.message : 'Could not load the deployment to update.');
      });

    return () => {
      isMounted = false;
    };
  }, [updateDeploymentId]);

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

  const isGithubExecutor = queuedDeployment?.executor === 'github-actions';

  // Mirrors DeploymentLiveMonitor's live-log polling (same endpoints, same cadence) so this page's
  // "Terraform runner logs" panel can show the same real GitHub Actions run/job/step status and
  // streaming log text, not just the backend's own summarized log lines — kept as its own copy here
  // rather than a shared hook so this addition can't regress the already-verified floating monitor.
  //
  // Deliberately NOT gated on deployment.status being "active" (queued/deploying/destroying/...) —
  // an earlier version of this effect was, and it meant a deployment that had *already* finished
  // (e.g. 'destroyed') by the time this page loaded never fetched even once: githubStatus stayed
  // undefined forever, and the panel showed "Waiting for GitHub to report this run..." permanently
  // for a run that was, in fact, long since reported. Always fetch at least once; only stop
  // re-polling once the *fetched run itself* (not the deployment's own status) is terminal.
  useEffect(() => {
    if (!isGithubExecutor || !queuedDeployment?._id) return;
    let isMounted = true;
    const deploymentId = queuedDeployment._id;

    async function poll() {
      try {
        const status = await getDeploymentGithubRun(deploymentId);
        if (!isMounted) return;
        setGithubStatus(status);
        setGithubStatusError('');
        setSelectedGithubJobId((current) => {
          if (current && status.jobs.some((job) => job.id === current)) return current;
          const active = status.jobs.find((job) => GITHUB_ACTIVE_RUN_STATUSES.includes(job.status));
          return active?.id ?? status.jobs[status.jobs.length - 1]?.id;
        });
      } catch (error) {
        if (!isMounted) return;
        setGithubStatusError(error instanceof Error ? error.message : 'Could not load GitHub Actions status.');
      }
    }

    void poll();
    const isRunTerminal = githubStatus?.run && !GITHUB_ACTIVE_RUN_STATUSES.includes(githubStatus.run.status);
    if (isRunTerminal) return () => { isMounted = false; };

    const timer = window.setInterval(() => void poll(), GITHUB_LOG_POLL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGithubExecutor, queuedDeployment?._id, githubStatus?.run?.status]);

  useEffect(() => {
    if (!isGithubExecutor || !queuedDeployment?._id || !selectedGithubJobId) return;
    let isMounted = true;
    const deploymentId = queuedDeployment._id;
    const jobId = selectedGithubJobId;

    async function fetchLogs() {
      setIsLoadingGithubJobLog(true);
      try {
        const result = await getDeploymentGithubRunJobLogs(deploymentId, jobId);
        if (!isMounted) return;
        setGithubJobLogText(result.text);
        setGithubJobLogError('');
      } catch (error) {
        if (!isMounted) return;
        setGithubJobLogError(error instanceof Error ? error.message : 'Logs for this job are not available yet.');
      } finally {
        if (isMounted) setIsLoadingGithubJobLog(false);
      }
    }

    void fetchLogs();
    const job = githubStatus?.jobs.find((candidate) => candidate.id === jobId);
    const isJobActive = !job || GITHUB_ACTIVE_RUN_STATUSES.includes(job.status);
    if (!isJobActive) return () => { isMounted = false; };

    const timer = window.setInterval(() => void fetchLogs(), GITHUB_LOG_POLL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [isGithubExecutor, queuedDeployment?._id, selectedGithubJobId, githubStatus?.jobs]);

  useEffect(() => {
    if (!followGithubJobLog || !githubJobLogRef.current) return;
    githubJobLogRef.current.scrollTop = githubJobLogRef.current.scrollHeight;
  }, [githubJobLogText, followGithubJobLog]);

  function handleGithubJobLogScroll() {
    const el = githubJobLogRef.current;
    if (!el) return;
    setFollowGithubJobLog(el.scrollHeight - el.scrollTop - el.clientHeight < 20);
  }

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

  // Creates the deployment record (and its underlying diagram) WITHOUT running Terraform —
  // autoApply: false is what keeps the backend from queuing a run, so it lands in 'draft' status
  // instead of 'deployed'/'queued'. A draft can be applied later from the Deployments page ("Apply"
  // button), or picked as a merge source into an already-deployed stack.
  async function saveAsDraft() {
    if (!canSaveDraft || isSavingDraft) return;

    setIsSavingDraft(true);
    setRequestError('');
    setShowDeploymentSuccess(false);

    try {
      const deployment = await createCanvasDeployment({
        name: deploymentName.trim(),
        awsAccountId: (selectedAccount as AwsAccountRecord)._id,
        activeRegion: plan.regions[0] ?? (selectedAccount as AwsAccountRecord).defaultRegion,
        nodes,
        edges,
        autoApply: false,
      });
      setQueuedDeployment(deployment);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to save this draft.');
    } finally {
      setIsSavingDraft(false);
    }
  }

  // Every early exit below now sets requestError before returning — a silent no-op here is
  // indistinguishable, from the user's side, from "the button did nothing," which is exactly what
  // got reported when a redeploy attempt on a Lambda-incompatible local-executor deployment silently
  // failed with no visible feedback at all. None of these conditions should normally be reachable
  // through the primary button itself (its own `disabled` covers most of them), but this function is
  // also reachable from other callers/edge cases, and a clear message here costs nothing.
  async function deployToAws() {
    if (isUpdateLikeMode) {
      if (!updateDeploymentId) {
        setRequestError('No deployment is loaded to update — reopen it from the Deployments page.');
        return;
      }
      if (plan.resourceCount === 0) {
        setRequestError('Add at least one AWS resource to the canvas before deploying.');
        return;
      }
      if (plan.blockers > 0) {
        setRequestError('Fix all blocking validation errors before deploying.');
        return;
      }
      if (deploymentStatus === 'running') {
        setRequestError('A deploy is already running for this session — wait for it to finish.');
        return;
      }
      if (isMergeMode && !hasMergeConnection) {
        setRequestError('Draw a connection from the imported nodes to the existing infrastructure before merging.');
        return;
      }
    } else if (!canDeploy || !selectedAccount || isAlreadyDeployed || !isNameValid) {
      setRequestError(deployButtonDisabledReason ?? 'This deployment cannot be started right now.');
      return;
    }

    const latestIssues = onValidate();
    const latestTerraformIssues = validateGeneratedTerraform(exportTerraform(nodes, edges));
    const latestAccessIssues = validateServiceAccess(nodes, user);
    const latestEffectiveIssues = [...latestIssues, ...latestTerraformIssues, ...latestAccessIssues];
    setCurrentIssues(latestIssues);
    if (latestEffectiveIssues.some((issue) => issue.severity === 'error')) {
      setRequestError(
        isMergeMode
          ? 'Merge blocked. Fix all required resource fields and validation errors, then retry.'
          : isUpdateMode
            ? 'Update blocked. Fix all required resource fields and validation errors, then retry.'
            : 'Deployment blocked. Fix all required resource fields and validation errors, then retry.',
      );
      return;
    }

    setDeploymentStatus('running');
    setRequestError('');
    if (!isUpdateLikeMode) setQueuedDeployment(null);
    setShowDeploymentSuccess(false);

    try {
      const deployment = isMergeMode
        ? (
            await mergeDeployment(updateDeploymentId as string, {
              sourceDeploymentId: mergeSourceDeploymentId as string,
              nodes,
              edges,
            })
          ).target
        : isUpdateMode
          ? await updateDeployment(updateDeploymentId as string, {
              activeRegion: plan.regions[0],
              nodes,
              edges,
            })
          : await createCanvasDeployment({
              name: deploymentName.trim(),
              awsAccountId: (selectedAccount as AwsAccountRecord)._id,
              activeRegion: plan.regions[0] ?? (selectedAccount as AwsAccountRecord).defaultRegion,
              nodes,
              edges,
              autoApply: true,
            });
      setQueuedDeployment(deployment);
      setDeploymentStatus(['deployed'].includes(deployment.status) ? 'success' : 'running');
      if (['queued', 'deploying'].includes(deployment.status)) watchDeployment(deployment._id);
    } catch (error) {
      setDeploymentStatus('error');
      setRequestError(error instanceof Error ? error.message : isMergeMode ? 'Merge request failed.' : isUpdateMode ? 'Update request failed.' : 'Deployment request failed.');
    }
  }

  return (
    <>
    <section className="deployment-page">
      <header className="deployment-modal__header">
        <div>
          <span>
            {isMergeMode
              ? 'Merge into deployed infrastructure'
              : isRedeployFromDestroyed
                ? 'Redeploy destroyed infrastructure'
                : isUpdateMode
                  ? 'Update deployed infrastructure'
                  : 'Deploy drawn infrastructure'}
          </span>
          <h3>{queuedDeployment?.name ?? plan.name}</h3>
        </div>
        <div className="deployment-modal__header-actions">
          <div className="deployment-page__actions">
            <button className="text-button" onClick={rerunValidation} type="button">
              Re-run validation
            </button>
            <button className="text-button" onClick={copyTerraform} type="button">
              <Copy size={16} />
              Copy Terraform
            </button>
            <button className="text-button" onClick={downloadPlan} type="button">
              <Download size={16} />
              Download Plan
            </button>
            <button className="text-button" onClick={downloadResourceInfo} type="button">
              <Download size={16} />
              Download Resource Info
            </button>
            <button className="text-button" disabled={!queuedDeployment} onClick={goToResourceInfoPage} type="button">
              <Eye size={16} />
              View Resource Info
            </button>
            {!isUpdateLikeMode && (
              <button
                className="text-button"
                disabled={!canSaveDraft || isSavingDraft || Boolean(queuedDeployment)}
                onClick={() => void saveAsDraft()}
                title="Save this diagram as a deployment record without running Terraform yet. Apply it later, or merge it into an already-deployed stack."
                type="button"
              >
                <Save size={16} />
                {isSavingDraft ? 'Saving...' : Boolean(queuedDeployment) ? 'Saved' : 'Save as Draft'}
              </button>
            )}
            <button
              className="deployment-primary"
              disabled={!canDeploy || deploymentStatus === 'running' || isAlreadyDeployed || (isMergeMode && !hasMergeConnection) || !isNameValid}
              onClick={deployToAws}
              title={deployButtonDisabledReason}
              type="button"
            >
              <Rocket size={16} />
              {deploymentStatus === 'running'
                ? isMergeMode
                  ? 'Merging...'
                  : isRedeployFromDestroyed
                    ? 'Redeploying...'
                    : isUpdateMode
                      ? 'Updating...'
                      : 'Deploying...'
                : deploymentStatus === 'success'
                  ? isMergeMode
                    ? 'Merged'
                    : isRedeployFromDestroyed
                      ? 'Redeployed'
                      : isUpdateMode
                        ? 'Updated'
                        : 'Deployed'
                  : isMergeMode
                    ? 'Merge Infrastructure'
                    : isRedeployFromDestroyed
                      ? 'Redeploy Infrastructure'
                      : isUpdateMode
                        ? 'Update Infrastructure'
                        : 'Deploy to AWS'}
            </button>
          </div>
          <button className="text-button" onClick={onClose} type="button">
            <ArrowLeft size={16} />
            Back to builder
          </button>
        </div>
      </header>
      {isMergeMode && (
        <div className="deployment-update-banner">
          Merging another diagram's resources into this already-deployed infrastructure. The imported nodes are highlighted on the canvas —
          draw a connection from one of them to an existing resource, then deploy. Terraform will apply only the new resources against this
          deployment's existing state; the source diagram will be locked once the merge is submitted so it can't be deployed a second time.
          {!hasMergeConnection && (
            <strong className="deployment-update-banner__warning"> No connection to the existing infrastructure yet — deploy is disabled until you add one.</strong>
          )}
        </div>
      )}
      {isUpdateMode && (
        <div className="deployment-update-banner">
          {isRedeployFromDestroyed ? (
            <>This infrastructure was previously destroyed — nothing from it is currently running. Deploying now will recreate everything fresh from this (possibly edited) diagram, the same as a first-time deploy.</>
          ) : (
            <>Editing an already-deployed infrastructure. Deploying now will run Terraform against the resources already in AWS and apply only
            the differences from your edits — it will not recreate everything from scratch.</>
          )}
        </div>
      )}

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

      <div className="deployment-page__body">
        <section className="deployment-panel deployment-log-panel deployment-log-panel--primary">
          <div className="deployment-panel__title">Terraform runner logs</div>
          {isGithubExecutor ? (
            <div className="deployment-log-panel__split">
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

              <div className="deployment-github-log">
                <div className="deployment-github-log__header">
                  <ScrollText size={14} />
                  <span>GitHub Actions live log</span>
                  {githubStatus?.run && (
                    <a href={githubStatus.run.htmlUrl} target="_blank" rel="noreferrer" title="Open this run on GitHub">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>

                {githubStatusError && <p className="deployment-github-log__error">{githubStatusError}</p>}

                {!githubStatus?.run && !githubStatusError && (
                  <div className="deployment-github-log__waiting">
                    <Loader2 size={13} className="deployment-github-log__glyph deployment-github-log__glyph--active" />
                    Waiting for GitHub to report this run…
                  </div>
                )}

                {githubStatus?.run && (
                  <div className="deployment-github-log__run">
                    <RunGlyph status={githubStatus.run.status} conclusion={githubStatus.run.conclusion} />
                    <span>Run #{githubStatus.run.runNumber} · {runGlyphLabel(githubStatus.run.status, githubStatus.run.conclusion)}</span>
                  </div>
                )}

                {githubStatus && githubStatus.jobs.length > 1 && (
                  <div className="deployment-github-log__jobs">
                    {githubStatus.jobs.map((job) => (
                      <button
                        className={`deployment-github-log__job${job.id === selectedGithubJobId ? ' deployment-github-log__job--active' : ''}`}
                        key={job.id}
                        onClick={() => setSelectedGithubJobId(job.id)}
                        type="button"
                      >
                        <RunGlyph status={job.status} conclusion={job.conclusion} small />
                        {job.name}
                      </button>
                    ))}
                  </div>
                )}

                {githubStatus?.jobs.find((job) => job.id === selectedGithubJobId)?.steps.map((step) => (
                  <div className="deployment-github-log__step" key={step.number}>
                    <RunGlyph status={step.status} conclusion={step.conclusion} small />
                    <span>{step.name}</span>
                  </div>
                ))}

                {githubJobLogError && <p className="deployment-github-log__error">{githubJobLogError}</p>}

                <pre className="deployment-github-log__pane" onScroll={handleGithubJobLogScroll} ref={githubJobLogRef}>
                  {githubJobLogText || (isLoadingGithubJobLog ? 'Loading logs…' : 'No log output yet.')}
                </pre>
                {!followGithubJobLog && (
                  <button
                    className="deployment-github-log__jump"
                    onClick={() => {
                      setFollowGithubJobLog(true);
                      if (githubJobLogRef.current) githubJobLogRef.current.scrollTop = githubJobLogRef.current.scrollHeight;
                    }}
                    type="button"
                  >
                    Jump to latest
                  </button>
                )}
              </div>
            </div>
          ) : runnerLogs.length ? (
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
            {!isUpdateLikeMode && (
              <label>
                <span>Deployment name</span>
                <input
                  value={deploymentName}
                  onChange={(event) => setDeploymentName(event.target.value)}
                  disabled={deploymentStatus === 'running' || Boolean(queuedDeployment)}
                  maxLength={120}
                  placeholder="Name this deployment"
                  type="text"
                />
              </label>
            )}
            <label>
              <span>Connected account</span>
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={isLoadingAccounts || deploymentStatus === 'running' || isUpdateLikeMode}
            >
              <option value="">{isLoadingAccounts ? 'Loading accounts...' : 'Select AWS account'}</option>
              {connectedAccounts.map((account) => (
                <option value={account._id} key={account._id}>
                  {account.name} - {account.accountId} ({account.defaultRegion})
                </option>
              ))}
            </select>
          </label>
          {isUpdateLikeMode && <p className="deployment-note">The AWS account is fixed to whichever account this infrastructure was originally deployed to.</p>}
          {!isUpdateLikeMode && !isLoadingAccounts && connectedAccounts.length === 0 && (
            <p className="deployment-note">Connect an AWS account from the dashboard before deploying infrastructure.</p>
          )}
          </section>

          <section className="deployment-panel">
            <div className="deployment-panel__title-row">
              <span className="deployment-panel__title">Deployment checks</span>
              <button className="text-button" onClick={() => setIsTerraformPreviewOpen(true)} type="button">
                <Code2 size={14} />
                View Terraform Preview
              </button>
            </div>
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
        </aside>
      </div>
    </section>
    {isTerraformPreviewOpen && (
      <div className="deployment-terraform-preview-backdrop" role="presentation" onClick={() => setIsTerraformPreviewOpen(false)}>
        <section
          className="deployment-terraform-preview-popup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terraform-preview-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header>
            <div>
              <span className="deployment-panel__title">Terraform preview</span>
              <h2 id="terraform-preview-title">{queuedDeployment?.name ?? plan.name}</h2>
            </div>
            <div className="deployment-terraform-preview-popup__actions">
              <button className="text-button" onClick={copyTerraform} type="button">
                <Copy size={16} />
                Copy
              </button>
              <button className="text-button" onClick={() => setIsTerraformPreviewOpen(false)} type="button" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </header>
          <pre className="deployment-code">{terraform}</pre>
        </section>
      </div>
    )}
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

function RunGlyph({ status, conclusion, small }: { status: string; conclusion: string | null; small?: boolean }) {
  const size = small ? 13 : 15;
  if (status === 'completed') {
    if (conclusion === 'success') return <CheckCircle2 className="deployment-github-log__glyph deployment-github-log__glyph--success" size={size} />;
    if (conclusion === 'skipped') return <Circle className="deployment-github-log__glyph deployment-github-log__glyph--muted" size={size} />;
    return <XCircle className="deployment-github-log__glyph deployment-github-log__glyph--error" size={size} />;
  }
  if (status === 'in_progress') return <Loader2 className="deployment-github-log__glyph deployment-github-log__glyph--active spin" size={size} />;
  return <Circle className="deployment-github-log__glyph deployment-github-log__glyph--muted" size={size} />;
}

function runGlyphLabel(status: string, conclusion: string | null) {
  if (status === 'completed') {
    if (conclusion === 'success') return 'Succeeded';
    if (conclusion === 'cancelled') return 'Cancelled';
    if (conclusion === 'skipped') return 'Skipped';
    return 'Failed';
  }
  if (status === 'in_progress') return 'Running…';
  if (status === 'queued' || status === 'waiting' || status === 'requested' || status === 'pending') return 'Queued…';
  return status;
}

export default DeploymentModal;
