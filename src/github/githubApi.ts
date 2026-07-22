import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type GithubConnection = {
  connected: boolean;
  githubId?: string;
  login: string;
  username?: string;
  name?: string;
  avatarUrl?: string;
  scopes: string[];
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

export function githubOAuthUrl({ mode = 'redirect', returnTo = '/settings' }: { mode?: 'redirect' | 'popup'; returnTo?: string } = {}) {
  const params = new URLSearchParams({ mode, returnTo });
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

async function githubRequest<T>(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const method = init.method ?? 'GET';
  const requestPath = method === 'GET' ? withCacheBust(path) : path;
  const response = await fetch(`${API_BASE_URL}${requestPath}`, {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'GitHub request failed');
  }

  return result.data as T;
}

function withCacheBust(path: string) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}_=${Date.now()}`;
}
