import { Router } from 'express';
import { getDashboardModules, getDashboardOverview } from '../controllers/dashboardController.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get('/modules', getDashboardModules);
dashboardRouter.get('/overview', getDashboardOverview);
