import { Router } from 'express';
import { receiveTerraformPayload, receiveTerraformPayloadSchema } from '../controllers/terraformPayloadController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const terraformPayloadRouter = Router();

terraformPayloadRouter.use(requireAuth);
terraformPayloadRouter.post('/', validateRequest(receiveTerraformPayloadSchema), receiveTerraformPayload);
