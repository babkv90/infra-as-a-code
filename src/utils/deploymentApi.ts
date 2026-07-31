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
    | 'cancelled'
    | 'merged';
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
  requestedBy?: string | {
    _id?: string;
    name?: string;
    email?: string;
    role?: string;
  };
  executor?: 'local' | 'github-actions';
  activeRun?: {
    githubRunId?: string;
    action?: string;
    status?: string;
    startedAt?: string;
  };
  awsAccount?: string;
  outputs?: Record<string, unknown>;
  drift?: DeploymentDriftResult;
  mergedInto?: string;
  validationIssues: Array<{ severity: string; message: string; nodeId?: string; edgeId?: string }>;
  logs: Array<{ message: string; level: string; at?: string }>;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

// Statuses a deployment must be in to be offered as a MERGE SOURCE in the UI — kept in sync with
// MERGE_SOURCE_ELIGIBLE_STATUSES in the backend's deploymentController.js. Anything past this point
// has (or may have) real AWS resources behind it, which merging cannot safely absorb.
export const MERGE_SOURCE_ELIGIBLE_STATUSES: DeploymentRecord['status'][] = ['draft', 'validating', 'planned', 'approval_required'];
// Statuses a deployment must be in to receive a merge — kept in sync with
// MERGE_TARGET_ELIGIBLE_STATUSES in the backend.
export const MERGE_TARGET_ELIGIBLE_STATUSES: DeploymentRecord['status'][] = ['deployed', 'failed'];

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

// Renames the deployment ("stack") label only — never touches the diagram, Terraform config, or
// AWS resources, so it works regardless of the deployment's current status.
export async function renameDeployment(id: string, name: string) {
  return apiRequest<DeploymentRecord>(`/deployments/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
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

export type MergePreview = {
  targetDeploymentId: string;
  sourceDeploymentId: string;
  activeRegion?: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
  importedNodeIds: string[];
};

// Computes (without persisting) what merging `sourceDeploymentId`'s diagram into deployment `id`
// would produce: the target's existing nodes/edges plus the source's, id-remapped so they can't
// collide. The caller loads this onto the canvas so the user can draw the connecting edge (the
// "missing piece of information") before submitting it to mergeDeployment.
export async function previewDeploymentMerge(id: string, sourceDeploymentId: string) {
  return apiRequest<MergePreview>(`/deployments/${id}/merge-preview`, {
    method: 'POST',
    body: JSON.stringify({ sourceDeploymentId }),
  });
}

export type MergeDeploymentPayload = {
  sourceDeploymentId: string;
  nodes: AwsNode[];
  edges: AwsEdge[];
};

export type MergeDeploymentResult = {
  target: DeploymentRecord;
  source: DeploymentRecord;
};

// Applies a completed merge: the target deployment is updated in place (same Terraform state/work
// dir — Terraform will diff and create only the newly-imported resources) and the source deployment
// is locked to 'merged' so it can never be independently applied again.
export async function mergeDeployment(id: string, payload: MergeDeploymentPayload) {
  return apiRequest<MergeDeploymentResult>(`/deployments/${id}/merge`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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

export type DeploymentDriftResource = {
  address: string;
  type: string;
  name: string;
  providerName: string;
  actions: string[];
  status: 'unchanged' | 'updated' | 'deleted' | 'replaced' | 'created';
};

export type DeploymentDriftResult = {
  checkedAt: string;
  status: 'unknown' | 'in_sync' | 'drifted' | 'error';
  summary: {
    total: number;
    changed: number;
    updated: number;
    deleted: number;
    replaced: number;
    created: number;
    noOp: number;
  };
  resources: DeploymentDriftResource[];
  message?: string;
  error?: string;
  region?: string;
  unmanagedResourceNote?: string;
};

// Syncs Terraform-managed drift metadata from AWS into the deployment record. This is read-only:
// it refreshes state and stores a sanitized report, but never imports unmanaged resources or applies.
export async function syncDeploymentDrift(id: string) {
  return apiRequest<DeploymentDriftResult>(`/deployments/${id}/sync-drift`, { method: 'POST' });
}

export type GithubRunStep = {
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  number: number;
  startedAt?: string;
  completedAt?: string;
};

export type GithubRunJob = {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  startedAt?: string;
  completedAt?: string;
  htmlUrl?: string;
  steps: GithubRunStep[];
};

export type GithubRun = {
  id: number;
  name: string;
  runNumber: number;
  event: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  branch: string;
  commitSha: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  runStartedAt?: string;
};

export type GithubRunStatus = {
  supported: boolean;
  run: GithubRun | null;
  jobs: GithubRunJob[];
};

// Polled by the live-logs popup while a github-actions-executor deployment is validating/deploying/
// destroying — cheap enough (one GitHub API round trip server-side) to call every few seconds.
export async function getDeploymentGithubRun(id: string) {
  return apiRequest<GithubRunStatus>(`/deployments/${id}/github-run`);
}

export async function getDeploymentGithubRunJobLogs(id: string, jobId: number) {
  return apiRequest<{ text: string }>(`/deployments/${id}/github-run/jobs/${jobId}/logs`);
}
