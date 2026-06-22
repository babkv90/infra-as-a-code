import { Router } from 'express';
import { authRouter } from './authRoutes.js';
import { dashboardRouter } from './dashboardRoutes.js';
import { diagramRouter } from './diagramRoutes.js';
import { deploymentRouter } from './deploymentRoutes.js';
import { terraformPayloadRouter } from './terraformPayloadRoutes.js';
import { awsRouter } from './awsRoutes.js';
import { agentRouter } from './agentRoutes.js';
import { userRouter } from './userRoutes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'iaas-backend' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/diagrams', diagramRouter);
apiRouter.use('/deployments', deploymentRouter);
apiRouter.use('/terraform-payload', terraformPayloadRouter);
apiRouter.use('/aws', awsRouter);
apiRouter.use('/agent', agentRouter);
apiRouter.use('/users', userRouter);
