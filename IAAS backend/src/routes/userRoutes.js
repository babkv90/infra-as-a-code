import { Router } from 'express';
import { roles } from '../constants/roles.js';
import { listUsers, updateUserRole, updateUserRoleSchema, updateUserStatus, updateUserStatusSchema } from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get('/', authorize(roles.ADMIN), listUsers);
userRouter.patch('/:id/role', authorize(roles.OWNER), validateRequest(updateUserRoleSchema), updateUserRole);
userRouter.patch('/:id/status', authorize(roles.ADMIN), validateRequest(updateUserStatusSchema), updateUserStatus);
