import { getStoredToken } from '../auth/authClient';
import { API_BASE_URL, apiRequest as sharedApiRequest } from '../utils/apiClient';

export type GithubConnection = {
  connected: boolean;
  githubId?: string;
  login: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
  scopes: string[];
  requiredScopes?: string[];
  missingScopes?: string[];
  reconnectRequired?: boolean;
  connectedAt?: string;
};

export type GithubRepository = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
  permissions?: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
};

export type GithubBranch = {
  name: string;
  protected: boolean;
  commitSha: string;
};

export type GithubRepositoryAccess = {
  owner: string;
  repo: string;
  workflowPath: string;
  canReadRepository: boolean;
  canPushContents: boolean;
  hasWorkflowScope: boolean;
  canWriteWorkflowFile: boolean;
  missing: string[];
  ok: boolean;
  message: string;
  reconnectRequired?: boolean;
  requiredScopes?: string[];
  grantedScopes?: string[];
  missingScopes?: string[];
};

export function githubOAuthUrl({ mode = 'redirect', returnTo = '/settings' }: { mode?: 'redirect' | 'popup'; returnTo?: string } = {}) {
  const params = new URLSearchParams({ mode, returnTo });
  const token = getStoredToken();
  if (token) params.set('token', token);
  console.log( `${API_BASE_URL}/github/oauth/connect?${params.toString()}`)
  return `${API_BASE_URL}/github/oauth/connect?${params.toString()}`;
}

export async function getGithubStatus() {
  return githubRequest<GithubConnection>('/github/status');
}

export async function disconnectGithub() {
  return githubRequest<GithubConnection>('/github/disconnect', { method: 'DELETE' });
}

export async function listGithubRepositories() {
  return githubRequest<GithubRepository[]>('/github/repos');
}

export async function listGithubBranches(owner: string, repo: string) {
  const params = new URLSearchParams({ owner, repo });
  return githubRequest<GithubBranch[]>(`/github/branches?${params.toString()}`);
}

export async function checkGithubRepositoryAccess(owner: string, repo: string, workflowPath?: string) {
  const params = new URLSearchParams({ owner, repo });
  if (workflowPath) params.set('workflowPath', workflowPath);
  return githubRequest<GithubRepositoryAccess>(`/github/repository-access?${params.toString()}`);
}

// GitHub connection status/repo/branch data changes outside this app (via GitHub itself), so GET
// requests are cache-busted and forced to bypass the browser's HTTP cache — every other API
// client module is fine relying on normal fetch caching, this one specifically isn't.
async function githubRequest<T>(path: string, init: RequestInit = {}) {
  const method = init.method ?? 'GET';
  const requestPath = method === 'GET' ? withCacheBust(path) : path;
  return sharedApiRequest<T>(
    requestPath,
    {
      ...init,
      cache: 'no-store',
    },
    'GitHub request failed',
  );
}

function withCacheBust(path: string) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}_=${Date.now()}`;
}
