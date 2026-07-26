import { apiRequest as sharedApiRequest } from '../utils/apiClient';
import type { AwsEdge, AwsNode } from '../types';

const diagramRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Diagram request failed');

export type SavedDiagram = {
  _id: string;
  name: string;
  description?: string;
  activeRegion?: string;
  tags?: string[];
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

export async function getSavedDiagram(id: string) {
  return diagramRequest<SavedDiagram>(`/diagrams/${id}`);
}

export type UpdateDiagramMetaPayload = {
  name?: string;
  description?: string;
  activeRegion?: string;
  tags?: string[];
};

// Metadata-only update (name/description/region/tags) — the backend's PATCH /diagrams/:id merges
// whatever fields are sent (createDiagramSchema.deepPartial()), so unlike updateSavedDiagram this
// never has to send (and risk overwriting) nodes/edges just to rename a diagram.
export async function updateSavedDiagramMeta(id: string, payload: UpdateDiagramMetaPayload) {
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
