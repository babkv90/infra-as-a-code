import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { dispatchGithubWorkflow, syncFilesToGithub, waitForLatestWorkflowRun } from './githubActionsClient.js';
import { lambdaSourceHashesTfvarsContent } from './githubTerraformRunner.js';
import { githubTokenForUser } from '../controllers/githubController.js';

const WORKFLOW_ID = 'terraform-validate.yml';

// The Lambda-executor counterpart to terraformCliValidator.js's inline `terraform validate` call —
// dispatches terraform-validate.yml and returns as soon as the run is confirmed started, rather than
// polling it to completion the way githubTerraformRunner.js does for a real apply/destroy. That
// distinction matters specifically because this runs inside a Lambda-hosted request: a `void`
// fire-and-forget poll loop has no guarantee of surviving past this request's response (Lambda can
// freeze/recycle the execution environment once the handler returns), so the result has to come back
// as its own fresh, independent request instead — terraform-validate.yml's own callback step POSTs to
// terraformValidateCallbackController.js, which is what actually moves the deployment out of
// 'validating'. This function's only job is to kick that off and confirm it started.
export async function dispatchTerraformValidation(deployment, { autoApply = false } = {}) {
  const token = await githubTokenForUser(deployment.requestedBy);
  if (!token) throw new ApiError(409, 'Connect GitHub (as the deployment requester) before validating Terraform via GitHub Actions.');

  const owner = env.DEPLOYMENT_GITHUB_OWNER;
  const repo = env.DEPLOYMENT_GITHUB_REPO;
  const branch = env.DEPLOYMENT_GITHUB_BRANCH;
  const deploymentPath = `deployments/${deployment._id}`;

  const files = [{ path: `${deploymentPath}/main.tf`, content: deployment.terraform }];
  const hashesContent = await lambdaSourceHashesTfvarsContent(deployment);
  if (hashesContent) files.push({ path: `${deploymentPath}/infraflow_lambda_hashes.auto.tfvars.json`, content: hashesContent });

  deployment.logs.push({ message: `Pushing generated Terraform to ${owner}/${repo}@${branch}:${deploymentPath}/ for validation.`, level: 'info' });
  await deployment.save();
  await syncFilesToGithub({ token, owner, repo, branch, message: `Infraflow validate — deployment ${deployment._id}`, files });

  const dispatchedAt = new Date();
  await dispatchGithubWorkflow({
    token,
    owner,
    repo,
    workflowId: WORKFLOW_ID,
    branch,
    inputs: {
      deployment_id: String(deployment._id),
      working_directory: deploymentPath,
    },
  });

  deployment.logs.push({ message: `Dispatched terraform-validate.yml on GitHub Actions.`, level: 'info' });
  await deployment.save();

  const run = await waitForLatestWorkflowRun({ token, owner, repo, workflowId: WORKFLOW_ID, branch, createdAfter: dispatchedAt });
  if (!run) throw new Error('GitHub Actions did not report a validation run after dispatch — check the repository\'s Actions tab directly.');

  deployment.pendingValidation = { runId: String(run.id), autoApply: Boolean(autoApply), startedAt: new Date() };
  deployment.logs.push({ message: `GitHub Actions validation run #${run.runNumber} (${run.htmlUrl}) started.`, level: 'info' });
  await deployment.save();

  return run;
}
