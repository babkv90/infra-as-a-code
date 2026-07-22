import { Router } from 'express';
import { roles } from '../constants/roles.js';
import {
  getSuperAdminOverview,
  grantCreditsSchema,
  grantDemoCredits,
  requestCreditsSchema,
  requestDemoCredits,
  updateAnyUserRole,
  updateSuperAdminRoleSchema,
} from '../controllers/superAdminController.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const superAdminRouter = Router();

superAdminRouter.use(requireAuth);
superAdminRouter.post('/credits/request', validateRequest(requestCreditsSchema), requestDemoCredits);
superAdminRouter.get('/overview', authorize(roles.SUPER_ADMIN), getSuperAdminOverview);
superAdminRouter.patch('/users/:id/role', authorize(roles.SUPER_ADMIN), validateRequest(updateSuperAdminRoleSchema), updateAnyUserRole);
superAdminRouter.post('/users/:id/credits', authorize(roles.SUPER_ADMIN), validateRequest(grantCreditsSchema), grantDemoCredits);
