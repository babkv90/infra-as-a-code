import { getStoredToken } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export type SavedDiagram = {
  _id: string;
  name: string;
  description?: string;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type SaveDiagramPayload = {
  name: string;
  description?: string;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
};

export async function listSavedDiagrams() {
  return diagramRequest<SavedDiagram[]>('/diagrams');
}

export async function createSavedDiagram(payload: SaveDiagramPayload) {
  return diagramRequest<SavedDiagram>('/diagrams', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSavedDiagram(id: string, payload: SaveDiagramPayload) {
  return diagramRequest<SavedDiagram>(`/diagrams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteSavedDiagram(id: string) {
  return diagramRequest<{ message?: string }>(`/diagrams/${id}`, {
    method: 'DELETE',
  });
}

async function diagramRequest<T>(path: string, init: RequestInit = {}) {
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
    throw new Error(result?.message ?? 'Diagram request failed');
  }

  return result.data as T;
}
