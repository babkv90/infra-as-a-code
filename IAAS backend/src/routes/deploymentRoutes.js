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
} from '../controllers/deploymentController.js';
import { roles } from '../constants/roles.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { lambdaZipUpload } from '../middleware/lambdaZipUpload.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const deploymentRouter = Router();

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
