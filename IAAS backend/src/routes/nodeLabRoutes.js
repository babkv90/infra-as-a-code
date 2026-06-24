import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getNodeRuntimeSnapshot, runNodeConceptDemo } from '../utils/nodeRuntimeLab.js';

export const nodeLabRouter = Router();

nodeLabRouter.use(requireAuth);

const runConceptSchema = z.object({
  body: z.object({
    mode: z.enum(['worker-thread', 'child-process', 'cluster']),
    intensity: z.enum(['light', 'standard', 'heavy']).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

nodeLabRouter.get(
  '/snapshot',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: getNodeRuntimeSnapshot(),
    });
  }),
);

nodeLabRouter.post(
  '/run',
  validateRequest(runConceptSchema),
  asyncHandler(async (req, res) => {
    const result = await runNodeConceptDemo(req.validated.body);

    res.json({
      success: true,
      data: result,
    });
  }),
);
