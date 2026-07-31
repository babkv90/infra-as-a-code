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
    return `${text} Reconnect GitHub from the Application Pipeline page and approve repo + workflow access. If this repository belongs to an organization, also authorize the OAuth app for the org/SAML account. For GitHub App tokens, enable Repository permissions: Actions read/write, Contents read/write, and Workflows read/write, then reinstall the app for this repository.`;
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
    const nextContent = Buffer.from(file.content, 'utf8').toString('base64');
    if (existing?.content && String(existing.content).replace(/\s/g, '') === nextContent) {
      // No commitSha here — existing.sha is this file's *blob* sha (its content identity), not a
      // commit sha, and callers that need "the commit with everything just pushed" (checking out by
      // SHA) must not mistake one for the other. Nothing was actually committed by this no-op, so
      // there is no fresh commit sha to report; the branch's already-current HEAD already has this
      // file from whatever earlier push put it there.
      synced.push({ path, commitSha: '', skipped: true });
      continue;
    }

    const updateResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `${message}: ${path}`,
        branch,
        content: nextContent,
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

export async function deleteFilesFromGithub({ token, owner, repo, branch, message, paths }) {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = githubApiHeaders(token);
  const deleted = [];

  for (const rawPath of paths) {
    const path = String(rawPath ?? '').replace(/^\/+/, '');
    if (!path) continue;

    const existingResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (existingResponse.status === 404) continue;
    const existing = await existingResponse.json().catch(async () => ({ message: await existingResponse.text() }));
    if (!existingResponse.ok) {
      throw new ApiError(existingResponse.status, `GitHub read failed for ${path}: ${existing?.message ?? 'unknown error'}`);
    }
    if (!existing?.sha) continue;

    const deleteResponse = await fetch(`${apiBase}/contents/${encodeURIComponentPath(path)}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        message: `${message}: remove ${path}`,
        branch,
        sha: existing.sha,
      }),
    });
    const result = await deleteResponse.json().catch(async () => ({ message: await deleteResponse.text() }));
    if (!deleteResponse.ok) {
      throw new ApiError(deleteResponse.status, githubSyncErrorMessage(path, result?.message));
    }
    deleted.push({ path, commitSha: result?.commit?.sha ?? '' });
  }

  return {
    files: deleted,
    commitSha: deleted[deleted.length - 1]?.commitSha ?? '',
  };
}

export async function syncFilesToGithubCommit({ token, owner, repo, branch, message, files, deletePaths = [] }) {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = githubApiHeaders(token);
  const refName = `heads/${branch}`;

  const refResponse = await fetch(`${apiBase}/git/ref/${encodeURIComponentPath(refName)}`, { headers });
  const ref = await refResponse.json().catch(async () => ({ message: await refResponse.text() }));
  if (!refResponse.ok) {
    throw new ApiError(refResponse.status, `GitHub branch lookup failed for ${branch}: ${ref?.message ?? 'unknown error'}`);
  }

  const baseCommitSha = ref?.object?.sha;
  if (!baseCommitSha) throw new ApiError(409, `GitHub branch ${branch} did not return a commit SHA.`);

  const commitResponse = await fetch(`${apiBase}/git/commits/${encodeURIComponent(baseCommitSha)}`, { headers });
  const baseCommit = await commitResponse.json().catch(async () => ({ message: await commitResponse.text() }));
  if (!commitResponse.ok) {
    throw new ApiError(commitResponse.status, `GitHub commit lookup failed for ${branch}: ${baseCommit?.message ?? 'unknown error'}`);
  }

  const treeResponse = await fetch(`${apiBase}/git/trees/${encodeURIComponent(baseCommit.tree.sha)}?recursive=1`, { headers });
  const baseTree = await treeResponse.json().catch(async () => ({ message: await treeResponse.text() }));
  if (!treeResponse.ok) {
    throw new ApiError(treeResponse.status, `GitHub tree lookup failed for ${branch}: ${baseTree?.message ?? 'unknown error'}`);
  }

  const nextFiles = sortWorkflowFilesLast(files).map((file) => ({
    path: String(file.path ?? '').replace(/^\/+/, ''),
    mode: '100644',
    type: 'blob',
    content: file.content,
  })).filter((file) => file.path);
  const nextFilePaths = new Set(nextFiles.map((file) => file.path));
  const existingPaths = new Set((baseTree.tree ?? []).map((item) => item.path));
  const deletes = Array.from(new Set(deletePaths.map((path) => String(path ?? '').replace(/^\/+/, '')).filter(Boolean)))
    .filter((path) => !nextFilePaths.has(path) && existingPaths.has(path))
    .map((path) => ({
      path,
      mode: '100644',
      type: 'blob',
      sha: null,
    }));

  if (!nextFiles.length && !deletes.length) {
    return { files: [], deletedWorkflowFiles: [], commitSha: baseCommitSha, skipped: true };
  }

  const createTreeResponse = await fetch(`${apiBase}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: [...nextFiles, ...deletes],
    }),
  });
  const nextTree = await createTreeResponse.json().catch(async () => ({ message: await createTreeResponse.text() }));
  if (!createTreeResponse.ok) {
    throw new ApiError(createTreeResponse.status, `GitHub tree create failed: ${nextTree?.message ?? 'unknown error'}`);
  }

  const createCommitResponse = await fetch(`${apiBase}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      tree: nextTree.sha,
      parents: [baseCommitSha],
    }),
  });
  const nextCommit = await createCommitResponse.json().catch(async () => ({ message: await createCommitResponse.text() }));
  if (!createCommitResponse.ok) {
    throw new ApiError(createCommitResponse.status, `GitHub commit create failed: ${nextCommit?.message ?? 'unknown error'}`);
  }

  const updateRefResponse = await fetch(`${apiBase}/git/refs/${encodeURIComponentPath(refName)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: nextCommit.sha }),
  });
  const updateRef = await updateRefResponse.json().catch(async () => ({ message: await updateRefResponse.text() }));
  if (!updateRefResponse.ok) {
    throw new ApiError(updateRefResponse.status, `GitHub branch update failed for ${branch}: ${updateRef?.message ?? 'unknown error'}`);
  }

  return {
    files: nextFiles.map((file) => ({ path: file.path, commitSha: nextCommit.sha })),
    deletedWorkflowFiles: deletes.map((file) => ({ path: file.path, commitSha: nextCommit.sha })),
    commitSha: nextCommit.sha,
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

// Fallback only — prefer syncFilesToGithub's own returned commitSha (the commit response from the
// exact PUT that created it, race-free) wherever the pushed path is guaranteed not to be skipped as
// unchanged. This does a *separate* read of the branch's ref after the fact, which was tried as the
// primary approach here and confirmed, in production, to occasionally race GitHub's own read-after-
// write consistency and return a commit that predates the push it was meant to reflect — worse than
// the problem it was meant to solve. Only reach for this when syncFilesToGithub's own commitSha is
// unavailable (e.g. every pushed file happened to be an unchanged skip, which reports a blob sha
// there instead of a commit sha).
export async function getBranchHeadSha({ token, owner, repo, branch }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/${encodeURIComponentPath(`heads/${branch}`)}`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) {
    throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? `Unable to read ${branch}'s current commit.`));
  }
  const sha = result?.object?.sha;
  if (!sha) throw new ApiError(409, `GitHub branch ${branch} did not return a commit SHA.`);
  return sha;
}

export async function getGithubRepositoryDefaultBranch({ token, owner, repo }) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: githubApiHeaders(token),
  });
  const result = await response.json().catch(async () => ({ message: await response.text() }));

  if (!response.ok) {
    throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'GitHub repository lookup failed.'));
  }

  return result.default_branch || 'main';
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

export async function githubWorkflowRuns({ token, owner, repo, workflowId, branch, status, perPage = 30 }) {
  const params = new URLSearchParams({ branch, per_page: String(perPage) });
  if (status) params.set('status', status);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs?${params.toString()}`,
    { headers: githubApiHeaders(token) },
  );
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow runs.'));
  return (result.workflow_runs ?? []).map(normalizeGithubWorkflowRun);
}

export async function getWorkflowRun({ token, owner, repo, runId }) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`, {
    headers: githubApiHeaders(token),
  });
  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read workflow run.'));
  return normalizeGithubWorkflowRun(result);
}

export async function cancelWorkflowRun({ token, owner, repo, runId }) {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    headers: githubApiHeaders(token),
  });

  if (response.status === 202) return { cancelled: true };
  if (response.status === 409) return { cancelled: false, alreadyFinished: true };

  const result = await response.json().catch(async () => ({ message: await response.text() }));
  if (!response.ok) throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to cancel workflow run.'));
  return { cancelled: true };
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

// Raw text logs for a single job — GitHub responds 302 to a short-lived signed URL serving plain
// text (works while the job is still running, not just after it finishes); fetch follows redirects
// by default, so this returns the actual log content, not the redirect itself.
export async function getWorkflowJobLogsText({ token, owner, repo, jobId }) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${encodeURIComponent(jobId)}/logs`,
    { headers: githubApiHeaders(token) },
  );
  if (!response.ok) {
    const result = await response.json().catch(async () => ({ message: await response.text() }));
    throw new ApiError(response.status, githubDeploymentErrorMessage(result?.message ?? 'Unable to read job logs.'));
  }
  return response.text();
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
