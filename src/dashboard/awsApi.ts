import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type AwsAccountRecord = {
  _id: string;
  name: string;
  accountId: string;
  roleArn: string;
  externalId?: string;
  defaultRegion: string;
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt?: string;
  lastError?: string;
  syncSummary?: AwsInsights;
};

export type AwsInsights = {
  billing: {
    monthlySpend: number;
    estimatedSavings: number;
    trend: number[];
    byService: Array<{ service: string; cost: number }>;
  };
  resources: Record<string, number>;
  recommendations: Array<{ title: string; savings: number; effort: string }>;
  securityFindings: Array<{ severity: string; title: string; resource: string }>;
  inventory: Array<{ service: string; count: number; health: string; spend: number }>;
  events?: Array<{ id?: string; name?: string; source?: string; username?: string; at?: string; resources?: Array<{ name?: string; type?: string }> }>;
  permissionErrors?: Array<{ service: string; message: string; code?: string }>;
  syncedAt?: string;
};

export type ConnectAwsPayload = {
  name: string;
  accountId: string;
  roleArn: string;
  externalId?: string;
  defaultRegion: string;
};

export async function listAwsRegions() {
  return apiRequest<string[]>('/aws/regions');
}

export async function listAwsAccounts() {
  return apiRequest<AwsAccountRecord[]>('/aws/accounts');
}

export async function connectAwsAccount(payload: ConnectAwsPayload) {
  return apiRequest<AwsAccountRecord>('/aws/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncAwsAccount(id: string) {
  return apiRequest<AwsAccountRecord>(`/aws/accounts/${id}/sync`, { method: 'POST' });
}

export async function disconnectAwsAccount(id: string) {
  return apiRequest<AwsAccountRecord>(`/aws/accounts/${id}`, { method: 'DELETE' });
}

export async function getAwsInsights() {
  return apiRequest<AwsInsights>('/aws/insights');
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
    throw new Error(result?.message ?? 'Request failed');
  }

  return result.data as T;
}
