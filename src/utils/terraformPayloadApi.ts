import { authFetch } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';
import { API_BASE_URL } from './apiBaseUrl';

export type TerraformPayload = {
  nodes: AwsNode[];
  edges: AwsEdge[];
  activeRegion?: string;
};

export type TerraformPayloadResponse = {
  success?: boolean;
  message?: string;
  data?: TerraformPayload;
};

export async function sendTerraformPayload(payload: TerraformPayload) {
  const response = await authFetch(`${API_BASE_URL}/terraform-payload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => null)) as TerraformPayloadResponse | null;

  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Unable to send terraform payload.');
  }

  return result;
}
