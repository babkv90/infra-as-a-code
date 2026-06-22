import { getStoredToken } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export type DeploymentRecord = {
  _id: string;
  name: string;
  status: 'draft' | 'validating' | 'planned' | 'approval_required' | 'queued' | 'deploying' | 'deployed' | 'failed' | 'cancelled';
  resourceCount: number;
  connectionCount: number;
  terraform: string;
  validationIssues: Array<{ severity: string; message: string; nodeId?: string; edgeId?: string }>;
  logs: Array<{ message: string; level: string; at?: string }>;
  startedAt?: string;
  finishedAt?: string;
};

export type CreateCanvasDeploymentPayload = {
  name?: string;
  awsAccountId: string;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
  autoApply?: boolean;
};

export async function createCanvasDeployment(payload: CreateCanvasDeploymentPayload) {
  return apiRequest<DeploymentRecord>('/deployments/from-canvas', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}`);
}

export async function applyDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/apply`, { method: 'POST' });
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
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
    throw new Error(result?.message ?? 'Deployment request failed');
  }

  return result.data as T;
}
