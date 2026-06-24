import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type NodeLabMode = 'worker-thread' | 'child-process' | 'cluster';
export type NodeLabIntensity = 'light' | 'standard' | 'heavy';

export type NodeRuntimeSnapshot = {
  process: {
    pid: number;
    ppid: number;
    uptimeSeconds: number;
    nodeVersion: string;
    platform: string;
    architecture: string;
  };
  cpu: {
    logicalCores: number;
    availableCores: number;
    loadAverage: number[];
    cores: Array<{
      id: number;
      model: string;
      speedMhz: number;
      activityScore: number;
    }>;
  };
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    systemFreeMb: number;
    systemTotalMb: number;
  };
  concepts: Array<{
    mode: NodeLabMode;
    label: string;
    purpose: string;
  }>;
};

export type NodeConceptRun = {
  ok: boolean;
  mode: NodeLabMode;
  requestedMode: NodeLabMode;
  intensity: NodeLabIntensity;
  primaryPid: number;
  nodeVersion: string;
  concept: string;
  summary: string;
  totalDurationMs: number;
  wallClockMs: number;
  cpu: {
    availableCores: number;
    loadAverage: number[];
  };
  units: Array<{
    role: string;
    threadId?: number;
    workerId?: number;
    pid: number;
    limit: number;
    primes: number;
    durationMs: number;
  }>;
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data?: T;
};

export async function getNodeRuntimeSnapshot() {
  return nodeLabRequest<NodeRuntimeSnapshot>('/node-lab/snapshot');
}

export async function runNodeConceptDemo(mode: NodeLabMode, intensity: NodeLabIntensity) {
  return nodeLabRequest<NodeConceptRun>('/node-lab/run', {
    method: 'POST',
    body: JSON.stringify({ mode, intensity }),
  });
}

async function nodeLabRequest<T>(path: string, init: RequestInit = {}) {
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

  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !result?.success || !result.data) {
    throw new Error(result?.message ?? 'Node runtime lab request failed.');
  }

  return result.data;
}
