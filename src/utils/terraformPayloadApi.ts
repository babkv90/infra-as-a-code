import { getStoredToken } from '../auth/authClient';
import type { AwsEdge, AwsNode } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

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
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/terraform-payload`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => null)) as TerraformPayloadResponse | null;

  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Unable to send terraform payload.');
  }

  return result;
}
