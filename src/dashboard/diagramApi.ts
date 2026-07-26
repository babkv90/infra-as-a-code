import { apiRequest as sharedApiRequest } from '../utils/apiClient';
import type { AwsEdge, AwsNode } from '../types';

const diagramRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Diagram request failed');

export type SavedDiagram = {
  _id: string;
  schemaVersion?: number;
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
  schemaVersion?: number;
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
