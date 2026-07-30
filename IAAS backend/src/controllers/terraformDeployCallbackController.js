import { z } from 'zod';
import { env } from '../config/env.js';
import { Deployment } from '../models/Deployment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { finishRun } from '../services/githubTerraformRunner.js';

// Called by terraform-deploy.yml's own final step, not a logged-in user — there is no req.user here,
// so this deliberately does NOT go through requireAuth (see deploymentRoutes.js, where this route is
// registered before that middleware is attached). Authenticated instead by a static shared secret
// both this backend and the workflow (as a GitHub Actions repository secret) know, which is enough
// for a callback from our own platform repo's own workflow — not a general-purpose public API.
export const callbackSchema = z.object({
  body: z.object({
    runId: z.union([z.string(), z.number()]),
    action: z.enum(['apply', 'destroy']),
    outcome: z.enum(['success', 'failure']),
    outputs: z.record(z.any()).optional().default({}),
    hasState: z.union([z.boolean(), z.string()]).optional().default(false),
    logExcerpt: z.string().optional().default(''),
  }),
});

// This is what actually finalizes a deployment now — not a background poll loop watching GitHub
// Actions (see githubTerraformRunner.js's top comment for why that was unreliable inside a
// Lambda-hosted request). GitHub calls this once terraform-deploy.yml's "Report result to Infraflow"
// step runs, independent of whether the backend process that originally dispatched the run is even
// still alive, which is exactly the property that makes this reliable.
export const receiveTerraformDeployCallback = asyncHandler(async (req, res) => {
  const provided = bearerToken(req);
  if (!env.DEPLOYMENT_CALLBACK_SECRET || provided !== env.DEPLOYMENT_CALLBACK_SECRET) {
    throw new ApiError(401, 'Invalid callback credentials.');
  }

  const { runId, action, outcome, outputs, hasState, logExcerpt } = req.validated.body;
  const deployment = await Deployment.findById(req.params.id);
  if (!deployment) return res.json({ success: true });

  // A stale callback from an earlier, superseded run on this same deployment (e.g. force-destroy
  // re-dispatched while an old run's callback was still in flight) — ignore it rather than let it
  // finalize over a newer run's own eventual callback.
  if (String(deployment.activeRun?.githubRunId ?? '') !== String(runId)) {
    return res.json({ success: true });
  }

  deployment.githubRun = {
    runId: String(runId),
    action,
    outcome,
    outputs,
    hasState: hasState === true || hasState === 'true',
    logExcerpt,
    receivedAt: new Date(),
  };

  const isUpdate = Boolean(deployment.activeRun?.isUpdate);
  const auto = Boolean(deployment.activeRun?.auto);
  await finishRun(deployment, {
    action,
    isUpdate,
    auto,
    runId,
    result: outcome === 'success' ? { outcome: 'success', outputs } : { outcome: 'failure', failureMessage: logExcerpt },
  });

  res.json({ success: true });
});

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}
