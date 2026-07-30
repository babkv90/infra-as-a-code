import { apiRequest } from '../utils/apiClient';

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
    monthlyTrend?: Array<{ month: string; label: string; start: string; end: string; cost: number }>;
    dailyTrend?: Array<{ date: string; label: string; start: string; end: string; cost: number }>;
    byService: Array<{ service: string; cost: number }>;
  };
  lambdaMetrics?: {
    totalInvocations: number;
    totalErrors: number;
    daily: Array<{ date: string; label: string; invocations: number; errors: number }>;
  };
  resources: Record<string, number>;
  recommendations: Array<{ title: string; savings: number; effort: string }>;
  securityFindings: Array<{ severity: string; title: string; resource: string }>;
  inventory: Array<{ service: string; count: number; health: string; spend: number }>;
  events?: Array<{ id?: string; name?: string; source?: string; username?: string; at?: string; resources?: Array<{ name?: string; type?: string }> }>;
  permissionErrors?: Array<{ service: string; message: string; code?: string }>;
  syncedAt?: string;
};

export type LambdaRealtimeMetrics = {
  region: string;
  updatedAt: string;
  windowMinutes: number;
  periodSeconds: number;
  functionCount: number;
  totalInvocations: number;
  totalErrors: number;
  points: Array<{ at: string; label: string; invocations: number; errors: number }>;
};

export type BillingRealtimeMetrics = {
  updatedAt: string;
  start: string;
  end: string;
  total: number;
  dailyTrend: Array<{ date: string; label: string; start: string; end: string; cost: number }>;
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

export async function getLambdaRealtimeInsights() {
  return apiRequest<LambdaRealtimeMetrics>('/aws/insights/lambda-realtime');
}

export async function getBillingRealtimeInsights() {
  return apiRequest<BillingRealtimeMetrics>('/aws/insights/billing-realtime');
}

export async function getDeployerIdentity() {
  return apiRequest<{ arn: string; accountId: string }>('/aws/deployer-identity');
}

export type IamRoleSummary = { arn: string; roleName: string; createDate?: string };

export async function listAccountIamRoles(accountId: string) {
  return apiRequest<IamRoleSummary[]>(`/aws/accounts/${accountId}/iam-roles`);
}
