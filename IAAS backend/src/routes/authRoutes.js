import { Router } from 'express';
import {
  forgotPassword,
  forgotPasswordSchema,
  login,
  loginSchema,
  logout,
  me,
  refresh,
  register,
  registerSchema,
  resetPassword,
  resetPasswordSchema,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const authRouter = Router();

authRouter.post('/register', validateRequest(registerSchema), register);
authRouter.post('/login', validateRequest(loginSchema), login);
authRouter.post('/forgot-password', validateRequest(forgotPasswordSchema), forgotPassword);
authRouter.post('/reset-password', validateRequest(resetPasswordSchema), resetPassword);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
