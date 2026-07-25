import { apiRequest as sharedApiRequest } from '../utils/apiClient';

const superAdminRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Super admin request failed');

export type SuperAdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  workspace?: {
    id: string;
    name: string;
    plan: string;
  };
  demoCredits: number;
  creditRequest?: {
    status?: string;
    requestedCredits?: number;
    reason?: string;
    note?: string;
    requestedAt?: string;
    reviewedAt?: string;
  };
  accessTier: string;
  allowedServices: number;
  aiEnabled: boolean;
  diagramsCreated: number;
  deploymentsCreated: number;
  successfulDeployments: number;
  lastActivityAt?: string;
  lastAction?: string;
  createdAt?: string;
  lastLoginAt?: string;
};

export type SuperAdminActivity = {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  actor?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
};

export type SuperAdminOverview = {
  totals: {
    users: number;
    diagrams: number;
    deployments: number;
    pendingCreditRequests: number;
  };
  users: SuperAdminUser[];
  recentActivities: SuperAdminActivity[];
};

export async function getSuperAdminOverview() {
  return superAdminRequest<SuperAdminOverview>('/superadmin/overview');
}

export async function updateSuperAdminUserRole(id: string, role: string) {
  return superAdminRequest<{ id: string; role: string }>(`/superadmin/users/${id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function grantSuperAdminCredits(id: string, credits: number, note?: string) {
  return superAdminRequest<{ id: string; demoCredits: number }>(`/superadmin/users/${id}/credits`, {
    method: 'POST',
    body: JSON.stringify({ credits, note }),
  });
}

export async function requestDemoCredits(requestedCredits: number, reason: string) {
  return superAdminRequest<{ creditRequest: SuperAdminUser['creditRequest'] }>('/superadmin/credits/request', {
    method: 'POST',
    body: JSON.stringify({ requestedCredits, reason }),
  });
}

// ---- Architecture change log + technical backlog ----

export const CHANGE_LOG_CATEGORIES = [
  'architecture',
  'storage',
  'execution-pipeline',
  'validation',
  'reliability',
  'performance',
  'security',
  'ui-ux',
] as const;
export type ChangeLogCategory = (typeof CHANGE_LOG_CATEGORIES)[number];

export const CHANGE_DIRECTIONS = ['positive', 'negative', 'neutral'] as const;
export type ChangeDirection = (typeof CHANGE_DIRECTIONS)[number];

export const BACKLOG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type BacklogSeverity = (typeof BACKLOG_SEVERITIES)[number];

export const BACKLOG_STATUSES = ['open', 'in-progress', 'resolved', 'wontfix'] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export type PerformanceSnapshot = {
  deploymentSuccessRate?: number;
  avgDeployTimeSec?: number;
  totalDeployments?: number;
  diskUsageMb?: number;
  capturedAt?: string;
};

export type ChangeLogEntry = {
  id: string;
  title: string;
  description: string;
  category: ChangeLogCategory;
  direction: ChangeDirection;
  impactRating: number;
  occurredAt?: string;
  author?: { id: string; name: string; email: string };
  relatedBacklogItems: Array<{ id: string; title: string; status: BacklogStatus; severity: BacklogSeverity } | string>;
  performanceSnapshot?: PerformanceSnapshot;
  createdAt?: string;
  updatedAt?: string;
};

export type BacklogItem = {
  id: string;
  title: string;
  description: string;
  severity: BacklogSeverity;
  status: BacklogStatus;
  identifiedDuring?: { id: string; title: string } | string;
  targetPhase: string;
  author?: { id: string; name: string; email: string };
  createdAt?: string;
  updatedAt?: string;
};

export type PerformanceSeriesPoint = {
  id: string;
  title: string;
  category: ChangeLogCategory;
  direction: ChangeDirection;
  impactRating: number;
  occurredAt?: string;
  metrics: PerformanceSnapshot;
};

export type CreateChangeLogInput = {
  title: string;
  description?: string;
  category: ChangeLogCategory;
  direction: ChangeDirection;
  impactRating: number;
  occurredAt?: string;
  relatedBacklogItems?: string[];
  diskUsageMb?: number;
};

export type CreateBacklogInput = {
  title: string;
  description?: string;
  severity: BacklogSeverity;
  status?: BacklogStatus;
  identifiedDuring?: string;
  targetPhase?: string;
};

export async function listChangeLog() {
  return superAdminRequest<{ entries: ChangeLogEntry[] }>('/superadmin/changelog');
}

export async function createChangeLogEntry(input: CreateChangeLogInput) {
  return superAdminRequest<{ entry: ChangeLogEntry }>('/superadmin/changelog', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateChangeLogEntry(id: string, input: Partial<CreateChangeLogInput>) {
  return superAdminRequest<{ entry: ChangeLogEntry }>(`/superadmin/changelog/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function getPerformanceSeries() {
  return superAdminRequest<{ series: PerformanceSeriesPoint[] }>('/superadmin/changelog/performance-series');
}

export async function listBacklog() {
  return superAdminRequest<{ items: BacklogItem[] }>('/superadmin/backlog');
}

export async function createBacklogItem(input: CreateBacklogInput) {
  return superAdminRequest<{ item: BacklogItem }>('/superadmin/backlog', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateBacklogItem(id: string, input: Partial<CreateBacklogInput>) {
  return superAdminRequest<{ item: BacklogItem }>(`/superadmin/backlog/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
