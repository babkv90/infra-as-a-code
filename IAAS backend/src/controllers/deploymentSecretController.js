import { Deployment } from '../models/Deployment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { getSensitiveOutputValue } from '../utils/secretRedaction.js';

// The broker endpoint (task item 2): requireAuth + this workspace-scoped lookup is the same
// ownership check every other deployment route already uses (see deploymentController.js) — a
// deployment id belonging to a different workspace simply 404s, same as getDeployment. The real
// value is fetched from Secrets Manager here, server-side, and only ever appears in this one
// response body — never in listDeployments/getDeployment's payload (see secretRedaction.js).
export const revealDeploymentOutputSecret = asyncHandler(async (req, res) => {
  const { id, resourceKey, fieldKey } = req.params;
  const deployment = await Deployment.findOne({ _id: id, workspace: req.user.workspace });
  if (!deployment) throw new ApiError(404, 'Deployment not found');

  let value;
  try {
    value = await getSensitiveOutputValue(deployment, resourceKey, fieldKey);
  } catch (error) {
    await auditLog(req, 'deployment.secret_reveal_failed', 'Deployment', deployment._id, {
      resourceKey,
      fieldKey,
      error: error.message ?? String(error),
    });
    throw new ApiError(502, 'Could not retrieve this value from Secrets Manager right now. Try again shortly.');
  }

  if (value === undefined) throw new ApiError(404, 'No secret is stored for this field.');

  await auditLog(req, 'deployment.secret_reveal', 'Deployment', deployment._id, { resourceKey, fieldKey });
  res.json({ success: true, data: { value } });
});
