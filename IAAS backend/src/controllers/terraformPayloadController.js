import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';

export const receiveTerraformPayloadSchema = z.object({
  body: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    activeRegion: z.string().optional(),
  }),
});

export const receiveTerraformPayload = asyncHandler(async (_req, res) => {
  res.json({ success: true, message: 'terraform payload recieved' });
});
