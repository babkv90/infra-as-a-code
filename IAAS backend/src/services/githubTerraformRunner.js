import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { assumeAwsRole } from './awsRoleCredentials.js';
import { assertDeployable, failDeployment, handleDeployFailureCleanup } from './deploymentGuards.js';
import {
  dispatchGithubWorkflow,
  getBranchHeadSha,
  getWorkflowRun,
  syncFilesToGithub,
  waitForLatestWorkflowRun,
} from './githubActionsClient.js';
import { getLambdaZipUploadMetadata } from './lambdaZipUploads.js';
import { createNotification } from './notificationService.js';
import { githubTokenForUser } from '../controllers/githubController.js';

const WORKFLOW_ID = 'terraform-deploy.yml';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — generous vs. the ~2-3 min/run budget; a run stuck
// this long is almost certainly hung, not slow, so give up and surface that rather than poll forever.
const ACTIVE_STATUSES = ['deploying', 'destroying'];

export async function runTerraformDeployment(deploymentId, { isUpdate = false } = {}) {
  const id = String(deploymentId);
  // Captured as soon as runWorkflow discovers the dispatched run's id — kept as a plain local
  // variable, not read back off deployment.activeRun, because finishRun clears that field the moment
  // this run reaches a terminal outcome, before hasRealState below would get a chance to read it.
  let currentRunId = null;

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;
    // Durable, DB-backed reentrancy guard — deployment.status is the source of truth, not a Set held
    // in this process's memory, so it holds even across a backend restart or a second instance.
    if (ACTIVE_STATUSES.includes(deployment.status)) return;

    const canProceed = await assertDeployable(deployment, {
      applyEnabled: env.TERRAFORM_APPLY_ENABLED,
      disabledMessage: 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS deployments.',
      phase: isUpdate ? 'update' : 'deploy',
    });
    if (!canProceed) return;

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment.', isUpdate ? 'update' : 'deploy');
      return;
    }

    deployment.status = 'deploying';
    deployment.startedAt = new Date();
    // See deploymentReconciliation.js — if this backend process dies mid-run, whatever's here is
    // what a fresh boot uses to try to resume watching the GitHub Actions run instead of just giving
    // up on it. isUpdate specifically matters: an interrupted update must never be auto-destroyed.
    deployment.activeRun = { action: 'apply', isUpdate, startedAt: new Date() };
    deployment.logs.push({ message: isUpdate ? 'Starting GitHub Actions Terraform update runner.' : 'Starting GitHub Actions Terraform deployment runner.', level: 'info' });
    await deployment.save();

    const result = await runWorkflow({
      deployment,
      account,
      action: 'apply',
      isUpdate,
      onRunStarted: (runId) => {
        currentRunId = runId;
      },
    });

    await finishRun(deployment, { action: 'apply', isUpdate, runId: currentRunId, result });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await finishRun(deployment, {
        action: 'apply',
        isUpdate,
        runId: currentRunId,
        result: { outcome: 'failure', failureMessage: error.message ?? 'Terraform deployment failed.' },
      });
    }
  }
}

export async function runTerraformDestroy(deploymentId, { force = false, auto = false } = {}) {
  const id = String(deploymentId);
  let currentRunId = null;

  try {
    const deployment = await Deployment.findById(id).populate('awsAccount');
    if (!deployment) return;
    if (!force && ACTIVE_STATUSES.includes(deployment.status)) return;

    const canProceed = await assertDeployable(deployment, {
      applyEnabled: env.TERRAFORM_APPLY_ENABLED,
      disabledMessage: 'Terraform apply is disabled. Set TERRAFORM_APPLY_ENABLED=true in IAAS backend/.env to run real AWS destroy operations.',
      phase: 'destroy',
    });
    if (!canProceed) return;

    const account = await AwsAccount.findById(deployment.awsAccount?._id ?? deployment.awsAccount);
    if (!account) {
      await failDeployment(deployment, 'AWS account not found for deployment destroy.', 'destroy');
      return;
    }

    deployment.status = 'destroying';
    deployment.startedAt = deployment.startedAt ?? new Date();
    deployment.finishedAt = undefined;
    deployment.activeRun = { action: 'destroy', isUpdate: false, startedAt: new Date() };
    deployment.logs.push({
      message: auto
        ? 'Automatically destroying AWS resources created before this deployment failed.'
        : force
          ? 'Force destroy requested by user. Proceeding even though the deployment may still be running elsewhere; Terraform state locking will safely reject this run if that is the case.'
          : 'Starting GitHub Actions Terraform destroy runner.',
      level: 'warning',
    });
    await deployment.save();

    const result = await runWorkflow({
      deployment,
      account,
      action: 'destroy',
      isUpdate: false,
      onRunStarted: (runId) => {
        currentRunId = runId;
      },
    });

    await finishRun(deployment, { action: 'destroy', auto, runId: currentRunId, result });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await finishRun(deployment, {
        action: 'destroy',
        auto,
        runId: currentRunId,
        result: { outcome: 'failure', failureMessage: error.message ?? 'Terraform destroy failed.' },
      });
    }
  }
}

// Called by deploymentReconciliation.js at server startup for any deployment found still in
// deploying/destroying — by definition orphaned, since no async work survives a process restart, but
// unlike the local executor, the actual Terraform run may still be alive on GitHub's infrastructure
// independent of this backend. Re-attaches to it via the same pollWorkflowStatus + finishRun path a
// normal (uninterrupted) run uses, so a completed-while-we-were-down run and a still-in-progress one
// are both handled correctly, and there is no second implementation of the finalize logic to drift
// out of sync with the first. Returns false if there's nothing to resume from (no runId recorded, or
// no GitHub token available) — the caller falls back to marking the deployment interrupted instead.
export async function resumeInterruptedRun(deployment) {
  const runId = deployment.activeRun?.githubRunId;
  if (!runId) return false;

  const action = deployment.activeRun?.action ?? (deployment.status === 'destroying' ? 'destroy' : 'apply');
  const isUpdate = Boolean(deployment.activeRun?.isUpdate);

  const token = await githubTokenForUser(deployment.requestedBy).catch(() => '');
  if (!token) return false;

  const owner = env.DEPLOYMENT_GITHUB_OWNER;
  const repo = env.DEPLOYMENT_GITHUB_REPO;
  const htmlUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;

  deployment.logs.push({ message: `Backend restarted while watching GitHub Actions run ${runId} — resuming.`, level: 'warning' });
  await deployment.save();

  try {
    const result = await pollWorkflowStatus({ deployment, token, owner, repo, runId, htmlUrl });
    await finishRun(deployment, { action, isUpdate, runId, result });
  } catch (error) {
    await finishRun(deployment, {
      action,
      isUpdate,
      runId,
      result: { outcome: 'failure', failureMessage: `Could not resume watching GitHub Actions run ${runId} after a backend restart: ${error.message ?? String(error)}` },
    });
  }
  return true;
}

// The one place a run's outcome (whether from a normal poll or a resumed one) turns into the
// deployment's final status, output capture, cleanup decision, and notification — shared so there is
// exactly one implementation of "what does success/failure actually mean for this deployment" rather
// than one for the normal path and a second, easy-to-drift copy for resuming after a restart.
async function finishRun(deployment, { action, isUpdate = false, auto = false, runId, result }) {
  const id = String(deployment._id);

  if (result.outcome !== 'success') {
    const phase = action === 'destroy' ? 'destroy' : isUpdate ? 'update' : 'deploy';
    await failDeployment(deployment, result.failureMessage ?? `Terraform ${action} failed in the GitHub Actions run.`, phase, { auto });

    if (action === 'apply') {
      // Same shared decision logic the local executor uses (see deploymentGuards.js) — only *how* we
      // check for real state and *how* we trigger destroy differ, via these callbacks.
      await handleDeployFailureCleanup({
        deployment,
        isUpdate,
        hasRealState: () => (runId ? hasStateFromCallback(id, runId) : false),
        runAutoDestroy: () => runTerraformDestroy(id, { force: true, auto: true }),
        cleanupArtifacts: () => Promise.resolve(), // nothing local to clean up — the runner VM is already gone
      });
    }
    return;
  }

  if (action === 'apply') {
    deployment.outputs = result.outputs ?? {};
    deployment.status = 'deployed';
    deployment.finishedAt = new Date();
    deployment.activeRun = undefined;
    deployment.logs.push({
      message: isUpdate
        ? 'Terraform update completed. Only the changed resources were touched; everything else was left as-is.'
        : 'Terraform apply completed. AWS resources should now be visible in the target account console.',
      level: 'info',
    });
    await deployment.save();

    await createNotification({
      workspace: deployment.workspace,
      type: 'deployment',
      status: 'success',
      title: isUpdate ? `Update to "${deployment.name}" succeeded` : `Deployment "${deployment.name}" succeeded`,
      message: isUpdate
        ? `Infrastructure updated to match the edited diagram (${deployment.resourceCount} resource${deployment.resourceCount === 1 ? '' : 's'}).`
        : `${deployment.resourceCount} resource${deployment.resourceCount === 1 ? '' : 's'} applied to AWS via GitHub Actions.`,
      resourceType: 'Deployment',
      resourceId: deployment._id,
      resourceName: deployment.name,
    });
    return;
  }

  deployment.status = auto ? 'failed' : 'destroyed';
  deployment.finishedAt = new Date();
  deployment.activeRun = undefined;
  deployment.logs.push({
    message: auto
      ? 'Automatic cleanup completed. All AWS resources created before the failure have been destroyed.'
      : 'Terraform destroy completed. The infrastructure from this deployment has been removed.',
    level: 'info',
  });
  await deployment.save();

  await createNotification({
    workspace: deployment.workspace,
    type: 'destroy',
    status: 'success',
    title: auto ? `Cleaned up "${deployment.name}" after failed deployment` : `Infrastructure "${deployment.name}" destroyed`,
    message: auto
      ? 'The deployment failed partway through. Resources it had already created in AWS were automatically destroyed, so nothing is left running or billing.'
      : 'Terraform destroy completed successfully.',
    resourceType: 'Deployment',
    resourceId: deployment._id,
    resourceName: deployment.name,
  });
}

// Persisted via Deployment.githubRun (set by terraformDeployCallbackController.js), not held in this
// process's memory — reads the same durable value back regardless of which backend instance/restart
// is asking. Only trusts it if it's actually the callback for THIS run, not a stale one left over
// from an earlier attempt on the same deployment.
async function hasStateFromCallback(deploymentId, runId) {
  const deployment = await Deployment.findById(deploymentId).select('githubRun');
  const run = deployment?.githubRun;
  if (!run || String(run.runId) !== String(runId)) return false;
  return Boolean(run.hasState);
}

// Pushes this deployment's generated Terraform (and any S3-mode Lambda hash tfvars) to our own repo,
// dispatches the terraform-deploy.yml workflow, and polls it to completion — mirroring, run for run,
// what the local executor does with a single blocking `terraform apply`/`destroy` invocation, just
// over the GitHub Actions API instead of a local child process.
async function runWorkflow({ deployment, account, action, isUpdate, onRunStarted }) {
  const token = await githubTokenForUser(deployment.requestedBy);
  if (!token) throw new Error('Connect GitHub (as the deployment requester) before running Terraform via GitHub Actions.');

  const owner = env.DEPLOYMENT_GITHUB_OWNER;
  const repo = env.DEPLOYMENT_GITHUB_REPO;
  const branch = env.DEPLOYMENT_GITHUB_BRANCH;
  const deploymentPath = `deployments/${deployment._id}`;

  const files = [{ path: `${deploymentPath}/main.tf`, content: deployment.terraform }];
  const hashesContent = await lambdaSourceHashesTfvarsContent(deployment);
  if (hashesContent) files.push({ path: `${deploymentPath}/infraflow_lambda_hashes.auto.tfvars.json`, content: hashesContent });

  deployment.logs.push({ message: `Pushing generated Terraform to ${owner}/${repo}@${branch}:${deploymentPath}/`, level: 'info' });
  await deployment.save();
  await syncFilesToGithub({ token, owner, repo, branch, message: `Infraflow ${action} — deployment ${deployment._id}`, files });
  // Read back the branch's real HEAD after pushing, rather than trusting syncFilesToGithub's own
  // per-file commitSha (see getBranchHeadSha's comment) — this is what terraform-deploy.yml checks
  // out by SHA, so it can never race a checkout of the branch's moving HEAD against this push.
  const commitSha = await getBranchHeadSha({ token, owner, repo, branch });

  // Same short-lived STS credentials the local executor would assume, just handed to the runner as
  // dispatch inputs instead of a local child-process env. The workflow masks these immediately (see
  // terraform-deploy.yml's first step) so they never appear in the run's log output. This repo is our
  // own platform repo, not user-facing, and the credentials expire on their own shortly after a
  // normal run finishes — acceptable for this pass; a per-account OIDC deploy role (mirroring what
  // provisionOidcDeployRole already does for the application-pipeline feature) would be a stronger
  // follow-up but is out of scope here.
  const credentials = await assumeAwsRole(account);
  const dispatchedAt = new Date();
  await dispatchGithubWorkflow({
    token,
    owner,
    repo,
    workflowId: WORKFLOW_ID,
    branch,
    inputs: {
      deployment_id: String(deployment._id),
      action,
      is_update: String(isUpdate),
      working_directory: deploymentPath,
      commit_sha: commitSha,
      aws_region: account.defaultRegion,
      aws_access_key_id: credentials.accessKeyId,
      aws_secret_access_key: credentials.secretAccessKey,
      aws_session_token: credentials.sessionToken ?? '',
    },
  });

  deployment.logs.push({ message: `Dispatched terraform-deploy.yml (${action}) on GitHub Actions.`, level: 'info' });
  await deployment.save();

  const run = await waitForLatestWorkflowRun({ token, owner, repo, workflowId: WORKFLOW_ID, branch, createdAfter: dispatchedAt });
  if (!run) throw new Error('GitHub Actions did not report a run after dispatch — check the repository\'s Actions tab directly.');
  onRunStarted?.(run.id);

  // Recorded on the deployment itself (not just the in-memory closure above) so a restart from this
  // point onward can be resumed by deploymentReconciliation.js instead of just abandoned.
  if (deployment.activeRun) deployment.activeRun.githubRunId = String(run.id);
  deployment.logs.push({ message: `GitHub Actions run #${run.runNumber} (${run.htmlUrl}) started.`, level: 'info' });
  await deployment.save();

  return pollWorkflowStatus({ deployment, token, owner, repo, runId: run.id, htmlUrl: run.htmlUrl });
}

// Reuses the exact 5s-interval polling cadence ApplicationPipelinePage already uses client-side for
// GitHub Actions run status (see DashboardShell.tsx) — same interval, applied server-side here since
// this function itself is what a fire-and-forget deploy/destroy call awaits to completion.
async function pollWorkflowStatus({ deployment, token, owner, repo, runId, htmlUrl }) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = '';

  while (Date.now() < deadline) {
    const run = await getWorkflowRun({ token, owner, repo, runId });

    if (run.status !== lastStatus) {
      lastStatus = run.status;
      deployment.logs.push({ message: `GitHub Actions run #${run.runNumber}: ${mapGithubStatusToDeploymentStatus(run.status, run.conclusion)}`, level: 'info' });
      await deployment.save();
    }

    if (run.status === 'completed') {
      const callback = await waitForCallback(String(deployment._id), runId, 15000);

      if (run.conclusion === 'success' && callback?.outcome === 'success') {
        return { outcome: 'success', outputs: callback.outputs ?? {} };
      }

      const failureMessage =
        callback?.logExcerpt ||
        `GitHub Actions run #${run.runNumber} concluded as "${run.conclusion}". See ${htmlUrl} for full logs.`;
      return { outcome: 'failure', failureMessage };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { outcome: 'failure', failureMessage: `Timed out waiting for GitHub Actions run ${htmlUrl} to complete after ${Math.round(POLL_TIMEOUT_MS / 60000)} minutes.` };
}

// Reads terraform-deploy.yml's callback result back from Deployment.githubRun (see
// terraformDeployCallbackController.js) instead of an in-memory queue — durable across a backend
// restart, and correct if this poll loop and the callback delivery ever land on different backend
// instances. Only accepts the callback if its runId matches the run actually being polled, so a
// leftover value from a previous attempt on this same deployment is never mistaken for this one.
async function waitForCallback(deploymentId, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deployment = await Deployment.findById(deploymentId).select('githubRun');
    const run = deployment?.githubRun;
    if (run && String(run.runId) === String(runId)) return run;
    await sleep(500);
  }
  return null;
}

// GitHub's status/conclusion model translated to this app's existing DeploymentRecord.status enum —
// see terraformDeploymentRunner.js and DeploymentModal.tsx for the values the rest of the app expects.
export function mapGithubStatusToDeploymentStatus(status, conclusion, { action = 'apply' } = {}) {
  if (status === 'queued') return 'queued';
  if (status === 'in_progress') return action === 'destroy' ? 'destroying' : 'deploying';
  if (status !== 'completed') return action === 'destroy' ? 'destroying' : 'deploying';

  if (conclusion === 'success') return action === 'destroy' ? 'destroyed' : 'deployed';
  if (conclusion === 'cancelled') return 'cancelled';
  // failure, timed_out, action_required, skipped, neutral, stale — all treated as a failure needing a
  // human look rather than silently assumed successful.
  return 'failed';
}

// Exported for githubTerraformValidator.js — the async validation workflow needs the exact same
// tfvars content as a real apply/destroy run, since terraformGenerator.js emits the same
// `lookup(var.lambda_source_code_hashes, ...)` reference either way (see stageLambdaZipUploads'
// comment in terraformDeploymentRunner.js for why this only matters in s3 storage mode).
export async function lambdaSourceHashesTfvarsContent(deployment) {
  if (!(deployment.lambdaZipUploadIds ?? []).length) return null;

  const hashes = {};
  for (const uploadId of deployment.lambdaZipUploadIds ?? []) {
    const metadata = await getLambdaZipUploadMetadata(uploadId);
    if (metadata) hashes[uploadId] = metadata.sourceCodeHash;
  }

  return JSON.stringify({ lambda_source_code_hashes: hashes });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
