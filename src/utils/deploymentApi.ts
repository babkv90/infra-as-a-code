import { apiFormRequest, apiRequest as sharedApiRequest } from './apiClient';
import type { AwsEdge, AwsNode } from '../types';

const apiRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Deployment request failed');

export type DeploymentRecord = {
  _id: string;
  name: string;
  status:
    | 'draft'
    | 'validating'
    | 'planned'
    | 'approval_required'
    | 'queued'
    | 'deploying'
    | 'deployed'
    | 'destroying'
    | 'destroyed'
    | 'failed'
    | 'cancelled';
  resourceCount: number;
  connectionCount: number;
  diagram?: {
    _id: string;
    name: string;
    activeRegion?: string;
    nodes?: AwsNode[];
    edges?: AwsEdge[];
  };
  terraform: string;
  terraformWorkDir?: string;
  awsAccount?: string;
  outputs?: Record<string, unknown>;
  validationIssues: Array<{ severity: string; message: string; nodeId?: string; edgeId?: string }>;
  logs: Array<{ message: string; level: string; at?: string }>;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateCanvasDeploymentPayload = {
  name?: string;
  awsAccountId: string;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
  autoApply?: boolean;
};

export async function createCanvasDeployment(payload: CreateCanvasDeploymentPayload) {
  return apiRequest<DeploymentRecord>('/deployments/from-canvas', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type LambdaZipUploadResult = { uploadId: string; fileName: string; sizeBytes: number };

// Uploads the actual zip bytes to the backend so the Terraform runner can copy them into a
// deployment's work directory before `apply` runs — a plain filename typed/picked in the browser
// can never resolve there, since Terraform executes on the backend server, not the user's machine.
export async function uploadLambdaZip(file: File) {
  const form = new FormData();
  form.set('zip', file);
  return apiFormRequest<LambdaZipUploadResult>('/deployments/lambda-zip', form, 'Zip upload failed');
}

export async function getDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}`);
}

export type UpdateCanvasDeploymentPayload = {
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
};

export async function updateDeployment(id: string, payload: UpdateCanvasDeploymentPayload) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/update`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listDeployments() {
  return apiRequest<DeploymentRecord[]>('/deployments');
}

export async function applyDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/apply`, { method: 'POST' });
}

export async function destroyDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/destroy`, { method: 'POST' });
}

export async function forceDestroyDeployment(id: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/force-destroy`, { method: 'POST' });
}

export type ResourceVerificationEntry = {
  name: string;
  label: string;
  service: string;
  terraformAddress: string;
  status: 'present' | 'missing' | 'destroyed' | 'unknown';
  consoleUrl: string;
};

export type ResourceVerificationResult = {
  checkedAt: string;
  region: string;
  regionConsoleUrl: string;
  resources: ResourceVerificationEntry[];
  error?: string;
};

// Runs `terraform plan -refresh-only` against the real AWS account (read-only, never applies) so
// the answer to "is this actually still there" reflects live AWS state, not just what Terraform's
// local state file last recorded — the two can disagree after a destroy attempt fails partway.
export async function verifyDeploymentResources(id: string) {
  return apiRequest<ResourceVerificationResult>(`/deployments/${id}/verify-resources`, { method: 'POST' });
}
