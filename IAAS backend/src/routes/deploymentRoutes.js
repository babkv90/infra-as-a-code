import { Router } from 'express';
import {
  applyDeployment,
  createCanvasDeploymentSchema,
  createDeploymentFromDiagram,
  createDeploymentSchema,
  createDeploymentFromCanvas,
  destroyDeployment,
  forceDestroyDeployment,
  getDeployment,
  listDeployments,
  queueDeployment,
  updateCanvasDeploymentSchema,
  updateDeploymentFromCanvas,
  uploadLambdaZip,
  verifyDeploymentResourcesRoute,
} from '../controllers/deploymentController.js';
import { callbackSchema, receiveTerraformDeployCallback } from '../controllers/terraformDeployCallbackController.js';
import { roles } from '../constants/roles.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { lambdaZipUpload } from '../middleware/lambdaZipUpload.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const deploymentRouter = Router();

// Registered before requireAuth deliberately — the caller is terraform-deploy.yml's own callback
// step, not a logged-in user (see terraformDeployCallbackController.js for its own secret-based
// auth). Express matches routes in registration order per-router, so this never reaches requireAuth.
deploymentRouter.post('/:id/github-run-callback', validateRequest(callbackSchema), receiveTerraformDeployCallback);

deploymentRouter.use(requireAuth);
deploymentRouter.get('/', listDeployments);
deploymentRouter.post('/lambda-zip', authorize(roles.DEVOPS), lambdaZipUpload('zip'), uploadLambdaZip);
deploymentRouter.get('/:id', getDeployment);
deploymentRouter.post('/from-canvas', authorize(roles.DEVOPS), validateRequest(createCanvasDeploymentSchema), createDeploymentFromCanvas);
deploymentRouter.post('/from-diagram/:diagramId', authorize(roles.DEVOPS), validateRequest(createDeploymentSchema), createDeploymentFromDiagram);
deploymentRouter.post('/:id/apply', authorize(roles.DEVOPS), applyDeployment);
deploymentRouter.post('/:id/update', authorize(roles.DEVOPS), validateRequest(updateCanvasDeploymentSchema), updateDeploymentFromCanvas);
deploymentRouter.post('/:id/queue', authorize(roles.DEVOPS), queueDeployment);
deploymentRouter.post('/:id/destroy', authorize(roles.DEVOPS), destroyDeployment);
deploymentRouter.post('/:id/force-destroy', authorize(roles.DEVOPS), forceDestroyDeployment);
deploymentRouter.post('/:id/verify-resources', authorize(roles.DEVOPS), verifyDeploymentResourcesRoute);
