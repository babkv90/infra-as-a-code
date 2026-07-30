import { Router } from 'express';
import { connectAwsAccount, createAwsAccountSchema, disconnectAwsAccount, getBillingRealtimeInsights, getDeployerIdentity, getInsights, getLambdaRealtimeInsights, listAccountIamRoles, listAwsAccounts, listAwsRegions, syncAwsAccount } from '../controllers/awsController.js';
import { roles } from '../constants/roles.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const awsRouter = Router();

awsRouter.use(requireAuth);
awsRouter.get('/regions', listAwsRegions);
awsRouter.get('/insights', getInsights);
awsRouter.get('/insights/billing-realtime', getBillingRealtimeInsights);
awsRouter.get('/insights/lambda-realtime', getLambdaRealtimeInsights);
awsRouter.get('/deployer-identity', getDeployerIdentity);
awsRouter.get('/accounts', listAwsAccounts);
awsRouter.get('/accounts/:id/iam-roles', listAccountIamRoles);
awsRouter.post('/accounts', authorize(roles.ADMIN), validateRequest(createAwsAccountSchema), connectAwsAccount);
awsRouter.delete('/accounts/:id', authorize(roles.ADMIN), disconnectAwsAccount);
awsRouter.post('/accounts/:id/sync', authorize(roles.DEVOPS), syncAwsAccount);
