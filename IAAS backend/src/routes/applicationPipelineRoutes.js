import { Router } from 'express';
import {
  cancelQueuedApplicationPipelineWorkflows,
  createApplicationPipeline,
  deleteApplicationPipeline,
  deployApplicationPipeline,
  forceStopApplicationPipelineDeployment,
  getPipelineTemplates,
  getApplicationPipelineDeploymentStatus,
  listApplicationPipelines,
  pipelineDeploySchema,
  pipelineRunResultSchema,
  githubSyncSchema,
  pipelineSchema,
  reportApplicationPipelineRunResult,
  syncApplicationPipelineToGithub,
  updateApplicationPipeline,
} from '../controllers/applicationPipelineController.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const applicationPipelineRouter = Router();

applicationPipelineRouter.use(requireAuth);
applicationPipelineRouter.get('/templates', getPipelineTemplates);
applicationPipelineRouter.get('/', listApplicationPipelines);
applicationPipelineRouter.post('/', validateRequest(pipelineSchema), createApplicationPipeline);
applicationPipelineRouter.put('/:id', validateRequest(pipelineSchema), updateApplicationPipeline);
applicationPipelineRouter.delete('/:id', deleteApplicationPipeline);
applicationPipelineRouter.post('/:id/github-sync', validateRequest(githubSyncSchema), syncApplicationPipelineToGithub);
applicationPipelineRouter.post('/:id/deploy', validateRequest(pipelineDeploySchema), deployApplicationPipeline);
applicationPipelineRouter.post('/:id/cancel-queued', cancelQueuedApplicationPipelineWorkflows);
applicationPipelineRouter.post('/:id/force-stop', forceStopApplicationPipelineDeployment);
applicationPipelineRouter.get('/:id/deployment-status', getApplicationPipelineDeploymentStatus);
applicationPipelineRouter.post('/:id/run-result', validateRequest(pipelineRunResultSchema), reportApplicationPipelineRunResult);
