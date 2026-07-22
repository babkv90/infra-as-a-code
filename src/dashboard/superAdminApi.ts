import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

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

async function superAdminRequest<T>(path: string, init: RequestInit = {}) {
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
    throw new Error(result?.message ?? 'Super admin request failed');
  }

  return result.data as T;
}
