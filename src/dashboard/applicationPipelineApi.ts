import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type ApplicationPipelineFile = {
  path: string;
  content: string;
  language: string;
  purpose?: string;
};

export type ApplicationPipelineRecord = {
  _id: string;
  name: string;
  appType: string;
  environment: 'development' | 'staging' | 'production';
  repository: {
    provider: string;
    url: string;
    branch: string;
    workflowPath: string;
    lastSyncedAt?: string;
    lastSyncCommit?: string;
  };
  target: {
    type: string;
    region: string;
    ecrRepository: string;
    serviceName: string;
    clusterName: string;
    bucketName: string;
    lambdaFunctionName: string;
    namespace: string;
  };
  commands: {
    install: string;
    test: string;
    build: string;
    start: string;
  };
  generatedFiles: ApplicationPipelineFile[];
  checklist: string[];
  status: string;
  awsDeployRole?: {
    arn: string;
    roleName: string;
    status: 'unprovisioned' | 'provisioned' | 'failed' | 'skipped';
    error: string;
    provisionedAt?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type CreateApplicationPipelinePayload = {
  name: string;
  appType: string;
  environment: 'development' | 'staging' | 'production';
  deploymentId?: string;
  repository: {
    url?: string;
    branch?: string;
  };
  commands?: Partial<ApplicationPipelineRecord['commands']>;
  target?: Partial<ApplicationPipelineRecord['target']>;
};

export type ApplicationDeploymentRun = {
  id: number;
  name?: string;
  runNumber?: number;
  event?: string;
  status?: string;
  conclusion?: string | null;
  branch?: string;
  commitSha?: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  runStartedAt?: string;
};

export type ApplicationDeploymentJob = {
  id: number;
  name: string;
  status?: string;
  conclusion?: string | null;
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
  steps?: Array<{
    name: string;
    status?: string;
    conclusion?: string | null;
    number?: number;
    startedAt?: string;
    completedAt?: string;
  }>;
};

export type ApplicationDeploymentStatus = {
  pipelineId: string;
  repository: {
    owner: string;
    repo: string;
    branch: string;
  };
  workflowPath: string;
  dispatchMode?: 'workflow_dispatch' | 'push_trigger';
  run: ApplicationDeploymentRun | null;
  jobs?: ApplicationDeploymentJob[];
  statusUnavailable?: boolean;
  statusMessage?: string;
  message?: string;
};

export async function listApplicationPipelines() {
  return pipelineRequest<ApplicationPipelineRecord[]>('/app-pipelines');
}

export async function createApplicationPipeline(payload: CreateApplicationPipelinePayload) {
  return pipelineRequest<ApplicationPipelineRecord>('/app-pipelines', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncPipelineToGithub(
  id: string,
  payload: { token?: string; owner: string; repo: string; branch: string; message?: string },
) {
  return pipelineRequest<{
    pipeline: ApplicationPipelineRecord;
    sync: { commitSha: string; files: Array<{ path: string; commitSha: string }> };
    oidc: ApplicationPipelineRecord['awsDeployRole'];
  }>(
    `/app-pipelines/${id}/github-sync`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function deployApplicationPipeline(
  id: string,
  payload: { owner?: string; repo?: string; branch?: string } = {},
) {
  return pipelineRequest<ApplicationDeploymentStatus>(`/app-pipelines/${id}/deploy`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getApplicationDeploymentStatus(
  id: string,
  params: { owner?: string; repo?: string; branch?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.owner) query.set('owner', params.owner);
  if (params.repo) query.set('repo', params.repo);
  if (params.branch) query.set('branch', params.branch);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return pipelineRequest<ApplicationDeploymentStatus>(`/app-pipelines/${id}/deployment-status${suffix}`);
}

export async function reportPipelineRunResult(
  id: string,
  payload: {
    runId: number;
    runNumber?: number;
    conclusion?: string | null;
    status?: string;
    htmlUrl?: string;
    owner?: string;
    repo?: string;
    branch?: string;
  },
) {
  return pipelineRequest<{ recorded: boolean }>(`/app-pipelines/${id}/run-result`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function pipelineRequest<T>(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Application pipeline request failed');
  }

  return result.data as T;
}
