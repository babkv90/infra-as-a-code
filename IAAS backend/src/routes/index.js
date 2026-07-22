import { Router } from 'express';
import { authRouter } from './authRoutes.js';
import { dashboardRouter } from './dashboardRoutes.js';
import { diagramRouter } from './diagramRoutes.js';
import { deploymentRouter } from './deploymentRoutes.js';
import { terraformPayloadRouter } from './terraformPayloadRoutes.js';
import { awsRouter } from './awsRoutes.js';
import { agentRouter } from './agentRoutes.js';
import { userRouter } from './userRoutes.js';
import { nodeLabRouter } from './nodeLabRoutes.js';
import { referenceDocRouter } from './referenceDocRoutes.js';
import { superAdminRouter } from './superAdminRoutes.js';
import { applicationPipelineRouter } from './applicationPipelineRoutes.js';
import { githubRouter } from './githubRoutes.js';
import { notificationRouter } from './notificationRoutes.js';
import { ticketRouter } from './ticketRoutes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'infraflow-backend' });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/diagrams', diagramRouter);
apiRouter.use('/deployments', deploymentRouter);
apiRouter.use('/terraform-payload', terraformPayloadRouter);
apiRouter.use('/aws', awsRouter);
apiRouter.use('/agent', agentRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/superadmin', superAdminRouter);
apiRouter.use('/app-pipelines', applicationPipelineRouter);
apiRouter.use('/github', githubRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/tickets', ticketRouter);
apiRouter.use('/node-lab', nodeLabRouter);
apiRouter.use('/reference-docs', referenceDocRouter);
