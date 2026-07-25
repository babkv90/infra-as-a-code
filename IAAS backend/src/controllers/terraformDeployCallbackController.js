import { z } from 'zod';
import { env } from '../config/env.js';
import { Deployment } from '../models/Deployment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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

// Persisted on the Deployment document (not held in this process's memory) so a callback that lands
// while the backend happens to be mid-restart isn't lost — see githubTerraformRunner.js's
// pollWorkflowStatus, which reads this same field back from the database rather than an in-memory
// queue local to whichever process happened to dispatch the run.
export const receiveTerraformDeployCallback = asyncHandler(async (req, res) => {
  const provided = bearerToken(req);
  if (!env.DEPLOYMENT_CALLBACK_SECRET || provided !== env.DEPLOYMENT_CALLBACK_SECRET) {
    throw new ApiError(401, 'Invalid callback credentials.');
  }

  const { runId, action, outcome, outputs, hasState, logExcerpt } = req.validated.body;
  await Deployment.updateOne(
    { _id: req.params.id },
    {
      $set: {
        githubRun: {
          runId: String(runId),
          action,
          outcome,
          outputs,
          hasState: hasState === true || hasState === 'true',
          logExcerpt,
          receivedAt: new Date(),
        },
      },
    },
  );

  res.json({ success: true });
});

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}
