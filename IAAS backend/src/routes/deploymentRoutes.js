import { Router } from 'express';
import {
  acceptDeploymentDriftRoute,
  acceptDriftSchema,
  applyDeployment,
  createCanvasDeploymentSchema,
  createDeploymentFromDiagram,
  createDeploymentSchema,
  createDeploymentFromCanvas,
  destroyDeployment,
  forceDestroyDeployment,
  getDeployment,
  getDeploymentGithubRun,
  getDeploymentGithubRunJobLogs,
  listDeployments,
  mergeDeploymentFromCanvas,
  mergeDeploymentSchema,
  previewDeploymentMerge,
  previewMergeDeploymentSchema,
  queueDeployment,
  renameDeployment,
  renameDeploymentSchema,
  updateCanvasDeploymentSchema,
  updateDeploymentFromCanvas,
  syncDeploymentDriftRoute,
  uploadLambdaZip,
  verifyDeploymentResourcesRoute,
} from '../controllers/deploymentController.js';
import { callbackSchema, receiveTerraformDeployCallback } from '../controllers/terraformDeployCallbackController.js';
import { terraformValidateCallbackSchema, receiveTerraformValidateCallback } from '../controllers/terraformValidateCallbackController.js';
import { revealDeploymentOutputSecret } from '../controllers/deploymentSecretController.js';
import { roles } from '../constants/roles.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { lambdaZipUpload } from '../middleware/lambdaZipUpload.js';
import { secretRevealRateLimit } from '../middleware/secretRateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const deploymentRouter = Router();

// Registered before requireAuth deliberately — the caller is terraform-deploy.yml's own callback
// step, not a logged-in user (see terraformDeployCallbackController.js for its own secret-based
// auth). Express matches routes in registration order per-router, so this never reaches requireAuth.
deploymentRouter.post('/:id/github-run-callback', validateRequest(callbackSchema), receiveTerraformDeployCallback);
deploymentRouter.post('/:id/terraform-validate-callback', validateRequest(terraformValidateCallbackSchema), receiveTerraformValidateCallback);

deploymentRouter.use(requireAuth);
deploymentRouter.get('/', listDeployments);
deploymentRouter.post('/lambda-zip', authorize(roles.DEVOPS), lambdaZipUpload('zip'), uploadLambdaZip);
deploymentRouter.get('/:id', getDeployment);
// Broker endpoint for masked/sensitive resource-info fields (task item 2) — fetches from Secrets
// Manager server-side, audit-logged, rate-limited per user. Same requireAuth + workspace-ownership
// model as every other :id route above/below it, deliberately not a new auth scheme.
deploymentRouter.get('/:id/secrets/output/:resourceKey/:fieldKey', secretRevealRateLimit, revealDeploymentOutputSecret);
deploymentRouter.get('/:id/github-run', getDeploymentGithubRun);
deploymentRouter.get('/:id/github-run/jobs/:jobId/logs', getDeploymentGithubRunJobLogs);
deploymentRouter.post('/from-canvas', authorize(roles.DEVOPS), validateRequest(createCanvasDeploymentSchema), createDeploymentFromCanvas);
deploymentRouter.post('/from-diagram/:diagramId', authorize(roles.DEVOPS), validateRequest(createDeploymentSchema), createDeploymentFromDiagram);
deploymentRouter.post('/:id/apply', authorize(roles.DEVOPS), applyDeployment);
deploymentRouter.post('/:id/update', authorize(roles.DEVOPS), validateRequest(updateCanvasDeploymentSchema), updateDeploymentFromCanvas);
deploymentRouter.post('/:id/merge-preview', authorize(roles.DEVOPS), validateRequest(previewMergeDeploymentSchema), previewDeploymentMerge);
deploymentRouter.post('/:id/merge', authorize(roles.DEVOPS), validateRequest(mergeDeploymentSchema), mergeDeploymentFromCanvas);
deploymentRouter.post('/:id/rename', authorize(roles.DEVOPS), validateRequest(renameDeploymentSchema), renameDeployment);
deploymentRouter.post('/:id/queue', authorize(roles.DEVOPS), queueDeployment);
deploymentRouter.post('/:id/destroy', authorize(roles.DEVOPS), destroyDeployment);
deploymentRouter.post('/:id/force-destroy', authorize(roles.DEVOPS), forceDestroyDeployment);
deploymentRouter.post('/:id/sync-drift', authorize(roles.DEVOPS), syncDeploymentDriftRoute);
deploymentRouter.post('/:id/accept-drift', authorize(roles.DEVOPS), validateRequest(acceptDriftSchema), acceptDeploymentDriftRoute);
deploymentRouter.post('/:id/verify-resources', authorize(roles.DEVOPS), verifyDeploymentResourcesRoute);
