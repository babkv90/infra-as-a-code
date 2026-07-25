import { ApiError } from '../utils/ApiError.js';

// Shared GitHub REST client for anything that pushes files to a repo and/or drives a GitHub Actions
// workflow — factored out of applicationPipelineController.js (the CI/CD pipeline feature) so the
// terraform-on-github-actions executor reuses the exact same dispatch/poll/jobs code instead of a
// second, independently-maintained copy. applicationPipelineController.js now imports from here too.

export function githubApiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export function encodeURIComponentPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function isGithubIntegrationPermissionError(error) {
  const message = String(error?.message ?? '');
  return error?.statusCode === 403 && /resource not accessible by integration/i.test(message);
}

export function githubDeploymentErrorMessage(message) {
  const text = String(message || 'GitHub deployment request failed.');
  if (/workflow does not have 'workflow_dispatch'/i.test(text)) {
    return `${text} Regenerate and sync the workflow so it includes workflow_dispatch.`;
  }
  if (/not found/i.test(text)) {
    return `${text} Confirm the workflow file has been synced to the selected repository and branch.`;
  }
  if (/resource not accessible by integration/i.test(text)) {
    return `${text} The connected GitHub app/token needs Actions read access and Contents/Workflow write access for this repository.`;
  }
  return text;
}

export function githubSyncErrorMessage(path, message = 'Unknown error') {
  const text = String(message || 'Unknown error');
  if (path.startsWith('.github/workflows/') && /resource not accessible by integration/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. GitHub blocks workflow file writes unless the connected app/token has workflow access. If this is a GitHub App, enable Repository permissions > Contents: Read and write and Workflows: Read and write in the GitHub App settings, reinstall or reauthorize it for this repository, then sync again. If this is an OAuth app, reconnect GitHub and approve the workflow scope.`;
  }

  if (/resource not accessible by integration/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. The selected GitHub account can see the repository, but the connected GitHub App/token cannot write repository contents. Enable Repository permissions > Contents: Read and write in the GitHub App settings, reinstall or reauthorize the app for this repository, then sync again.`;
  }

  if (/protected branch/i.test(text)) {
    return `GitHub sync failed for ${path}: ${text}. Choose an unprotected branch or allow this GitHub account to push to the selected protected branch.`;
  }

  return `GitHub sync failed for ${path}: ${text}`;
}

// Creates or updates each file via the Contents API (base64 body, sha-based update-or-create).
// Workflow files are written last so a mid-sync failure never leaves a workflow referencing files
// that didn't make it in.
export async function syncFilesToGithub({ token, owner, repo, branch, message, files }) {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = githubApiHeaders(token);
  const synced = [];

  for (const file of sortWorkflowFilesLast(files)) {
    const path = file.path.replace(/^\/+/, '');
    const existingResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    const existing = existingResponse.ok ? await existingResponse.json() : undefined;
    if (!existingResponse.ok && existingResponse.status !== 404) {
      const text = await existingResponse.text();
      throw new ApiError(existingResponse.status, `GitHub read failed for ${path}: ${text}`);
    }

    const updateResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `${message}: ${path}`,
        branch,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    });

    const result = await updateResponse.json().catch(async () => ({ message: await updateResponse.text() }));
    if (!updateResponse.ok) {
      throw new ApiError(updateResponse.status, githubSyncErrorMessage(path, result?.message));
    }
    synced.push({ path, commitSha: result?.commit?.sha ?? '' });
  }

  return {
    files: synced,
    commitSha: synced[synced.length - 1]?.commitSha ?? '',
  };
}

function sortWorkflowFilesLast(files) {
  return [...files].sort((a, b) => {
    const aWorkflow = String(a.path ?? '').replace(/^\/+/, '').startsWith('.github/workflows/');
    const bWorkflow = String(b.path ?? '').replace(/^\/+/, '').startsWith('.github/workflows/');
    return Number(aWorkflow) - Number(bWorkflow);
  });
}

export async function dispatchGithubWorkflow({ token, owner, repo, workflowId, branch, inputs = {} }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
    {
      method: 'POST',
      headers: githubApiHeaders(token),
      body: JSON.stringify({ ref: branch, inputs }),
    },
  );

  if (response.status === 204) return;

  const result = await response.json().catch(async () => ({ message: await response.text() }));
  throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Workflow dispatch failed.'));
}

// GitHub's dispatch API doesn't hand back the run it just created, so this polls the workflow's
// recent runs and matches by "created at or after we dispatched" — a few seconds of retry covers the
// normal delay between dispatch and the run appearing in the list.
export async function waitForLatestWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter }) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(1400);
    const run = await latestGithubWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter });
    if (run) return run;
  }
  return null;
}

export async function latestGithubWorkflowRun({ token, owner, repo, workflowId, branch, createdAfter }) {
  const params = new URLSearchParams({ branch, per_page: '5' });
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${params.toString()}`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow runs.'));

  const runs = result.workflow_runs ?? [];
  const run = createdAfter
    ? runs.find((item) => new Date(item.created_at).getTime() >= new Date(createdAfter).getTime() - 3000)
    : runs[0];
  return run ? normalizeGithubWorkflowRun(run) : null;
}

export async function getWorkflowRun({ token, owner, repo, runId }) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`, {
    headers: githubApiHeaders(token),
  });
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow run.'));
  return normalizeGithubWorkflowRun(result);
}

export async function githubWorkflowRunJobs({ token, owner, repo, runId }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=20`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow jobs.'));
  return (result.jobs ?? []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    htmlUrl: job.html_url,
    steps: (job.steps ?? []).map((step) => ({
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      number: step.number,
      startedAt: step.started_at,
      completedAt: step.completed_at,
    })),
  }));
}

export function normalizeGithubWorkflowRun(run) {
  return {
    id: run.id,
    name: run.name,
    runNumber: run.run_number,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    commitSha: run.head_sha,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
