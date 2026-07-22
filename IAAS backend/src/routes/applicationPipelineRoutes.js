import { Router } from 'express';
import {
  createApplicationPipeline,
  deployApplicationPipeline,
  getPipelineTemplates,
  getApplicationPipelineDeploymentStatus,
  listApplicationPipelines,
  pipelineDeploySchema,
  pipelineRunResultSchema,
  githubSyncSchema,
  pipelineSchema,
  reportApplicationPipelineRunResult,
  syncApplicationPipelineToGithub,
} from '../controllers/applicationPipelineController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const applicationPipelineRouter = Router();

applicationPipelineRouter.use(requireAuth);
applicationPipelineRouter.get('/templates', getPipelineTemplates);
applicationPipelineRouter.get('/', listApplicationPipelines);
applicationPipelineRouter.post('/', validateRequest(pipelineSchema), createApplicationPipeline);
applicationPipelineRouter.post('/:id/github-sync', validateRequest(githubSyncSchema), syncApplicationPipelineToGithub);
applicationPipelineRouter.post('/:id/deploy', validateRequest(pipelineDeploySchema), deployApplicationPipeline);
applicationPipelineRouter.get('/:id/deployment-status', getApplicationPipelineDeploymentStatus);
applicationPipelineRouter.post('/:id/run-result', validateRequest(pipelineRunResultSchema), reportApplicationPipelineRunResult);
