import { env } from '../config/env.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { Deployment } from '../models/Deployment.js';
import { assumeAwsRole } from './awsRoleCredentials.js';
import { assertDeployable, failDeployment, handleDeployFailureCleanup } from './deploymentGuards.js';
import {
  dispatchGithubWorkflow,
  getBranchHeadSha,
  syncFilesToGithub,
  waitForLatestWorkflowRun,
} from './githubActionsClient.js';
import { getLambdaZipUploadMetadata } from './lambdaZipUploads.js';
import { createNotification } from './notificationService.js';
import { githubTokenForUser } from '../controllers/githubController.js';

const WORKFLOW_ID = 'terraform-deploy.yml';
const ACTIVE_STATUSES = ['deploying', 'destroying'];

// Dispatches terraform-deploy.yml and returns as soon as the run is confirmed started — deliberately
// does NOT poll it to completion. This function runs inside a Lambda-hosted request (called via
// `void` from deploymentController.js, same as before), and a background poll loop has no guarantee
// of surviving past that request's response: Lambda can freeze/recycle the execution environment once
// the handler returns. That's what caused a real, confirmed bug — a destroy that flipped status to
// "destroying" but never actually reached GitHub Actions, because the poll loop (and everything after
// it, including the dispatch itself on an unlucky freeze) never got to run.
// finishRun below is now driven entirely by terraformDeployCallbackController.js — the workflow's own
// "Report result to Infraflow" step, a fresh independent request GitHub makes regardless of whether
// this backend process is still alive. That's what actually finalizes the deployment.
export async function runTerraformDeployment(deploymentId, { isUpdate = false } = {}) {
  const id = String(deploymentId);

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
    deployment.activeRun = { action: 'apply', isUpdate, startedAt: new Date() };
    deployment.logs.push({ message: isUpdate ? 'Starting GitHub Actions Terraform update runner.' : 'Starting GitHub Actions Terraform deployment runner.', level: 'info' });
    await deployment.save();

    await dispatchWorkflow({ deployment, account, action: 'apply', isUpdate });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await finishRun(deployment, {
        action: 'apply',
        isUpdate,
        runId: null,
        result: { outcome: 'failure', failureMessage: error.message ?? 'Terraform deployment failed.' },
      });
    }
  }
}

export async function runTerraformDestroy(deploymentId, { force = false, auto = false } = {}) {
  const id = String(deploymentId);

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
    deployment.activeRun = { action: 'destroy', isUpdate: false, auto, startedAt: new Date() };
    deployment.logs.push({
      message: auto
        ? 'Automatically destroying AWS resources created before this deployment failed.'
        : force
          ? 'Force destroy requested by user. Proceeding even though the deployment may still be running elsewhere; Terraform state locking will safely reject this run if that is the case.'
          : 'Starting GitHub Actions Terraform destroy runner.',
      level: 'warning',
    });
    await deployment.save();

    await dispatchWorkflow({ deployment, account, action: 'destroy', isUpdate: false });
  } catch (error) {
    const deployment = await Deployment.findById(id);
    if (deployment) {
      await finishRun(deployment, {
        action: 'destroy',
        auto,
        runId: null,
        result: { outcome: 'failure', failureMessage: error.message ?? 'Terraform destroy failed.' },
      });
    }
  }
}

// Called by terraformDeployCallbackController.js — the one place a run's outcome turns into the
// deployment's final status, output capture, cleanup decision, and notification.
export async function finishRun(deployment, { action, isUpdate = false, auto = false, runId, result }) {
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

// Pushes this deployment's generated Terraform (and any S3-mode Lambda hash tfvars) to our own repo
// and dispatches the terraform-deploy.yml workflow — the local executor's counterpart is a single
// blocking `terraform apply`/`destroy` child process; this is the same idea over the GitHub Actions
// API, except it returns once the run is confirmed started rather than waiting for it to finish (see
// runTerraformDeployment's comment for why: this whole call must stay fast enough to safely await
// inside a Lambda-hosted request).
async function dispatchWorkflow({ deployment, account, action, isUpdate }) {
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
  const sync = await syncFilesToGithub({ token, owner, repo, branch, message: `Infraflow ${action} — deployment ${deployment._id}`, files });
  // The commit SHA from the push's own response, not a separate follow-up read — confirmed by a real
  // failure that a getBranchHeadSha() call immediately after syncFilesToGithub can race GitHub's own
  // read-after-write consistency and return a commit that predates the push. deploymentPath is always
  // a fresh, never-before-seen path (one per deployment), so this file is never "skipped" as
  // unchanged — the branch-head fallback below only covers the theoretical case where it somehow was.
  const commitSha = sync.commitSha || (await getBranchHeadSha({ token, owner, repo, branch }));

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

  // Recorded on the deployment itself so terraformDeployCallbackController.js can confirm an
  // incoming callback matches the run actually dispatched for it, not a stale one from an earlier
  // attempt on the same deployment.
  if (deployment.activeRun) deployment.activeRun.githubRunId = String(run.id);
  deployment.logs.push({ message: `GitHub Actions run #${run.runNumber} (${run.htmlUrl}) started.`, level: 'info' });
  await deployment.save();
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
