import { Deployment } from '../models/Deployment.js';
import { Diagram } from '../models/Diagram.js';
import { lambdaZipUploadIdsFromNodes } from '../utils/terraformGenerator.js';
import { deleteLambdaZipUpload, getLambdaZipUploadMetadata, listLambdaZipUploadIds } from './lambdaZipUploads.js';

// A given upload id is needed for as long as some future `runTerraformDeployment` call (a fresh
// deploy, or "Update Infrastructure" on an already-deployed one) might still reference it — which,
// per stageLambdaZipUploads in terraformDeploymentRunner.js, always re-reads the master copy here
// rather than relying on whatever a deployment's own work directory already has cached from a prior
// run. That happens whenever:
//   - a Deployment document still lists it in lambdaZipUploadIds (captured at the last plan/update —
//     an already-deployed infrastructure can always be updated again later without re-uploading), or
//   - a saved Diagram's Lambda node still points at it (about to be deployed for the first time).
// Destroys never re-read this directory at all (confirmed: stageLambdaZipUploads has exactly one call
// site, inside runTerraformDeployment), so an upload no longer needed for either case above is safe
// to remove regardless of whether some already-destroyed deployment's stored Terraform text still
// mentions it in history.
const DEFAULT_GRACE_MS = 2 * 60 * 60 * 1000;

export async function cleanupOrphanedLambdaZipUploads({ graceMs = DEFAULT_GRACE_MS } = {}) {
  const allUploadIds = await listLambdaZipUploadIds();
  if (!allUploadIds.length) return { scanned: 0, deleted: 0 };

  const [deployments, diagrams] = await Promise.all([
    Deployment.find({}, 'lambdaZipUploadIds').lean(),
    Diagram.find({}, 'nodes').lean(),
  ]);

  const inUse = new Set();
  for (const deployment of deployments) {
    for (const id of deployment.lambdaZipUploadIds ?? []) inUse.add(id);
  }
  for (const diagram of diagrams) {
    for (const id of lambdaZipUploadIdsFromNodes(diagram.nodes ?? [])) inUse.add(id);
  }

  let deleted = 0;
  const now = Date.now();
  for (const uploadId of allUploadIds) {
    if (inUse.has(uploadId)) continue;

    // Grace period: an upload with no reference yet might just have been picked seconds ago, before
    // the diagram that will use it gets saved — deleting it out from under an in-progress "pick a
    // zip, then Deploy" flow would be exactly the false-positive validation failure this whole
    // feature exists to prevent. A missing/unparseable sidecar is treated as immediately eligible
    // rather than skipped forever — saveLambdaZipUpload has always written one, so its absence is
    // itself evidence this is a pre-existing/legacy file, not something mid-upload right now.
    const metadata = await getLambdaZipUploadMetadata(uploadId).catch(() => null);
    const uploadedAt = metadata?.uploadedAt ? Date.parse(metadata.uploadedAt) : undefined;
    if (uploadedAt !== undefined && !Number.isNaN(uploadedAt) && now - uploadedAt < graceMs) continue;

    await deleteLambdaZipUpload(uploadId).catch((error) => {
      console.error(`Failed to delete orphaned lambda zip upload ${uploadId}:`, error.message ?? error);
    });
    deleted += 1;
  }

  return { scanned: allUploadIds.length, deleted };
}
