import { Router } from 'express';
import { roles } from '../constants/roles.js';
import {
  createBacklog,
  createBacklogSchema,
  createChangeLog,
  createChangeLogSchema,
  getPerformanceSeries,
  listBacklog,
  listChangeLog,
  updateBacklog,
  updateBacklogSchema,
  updateChangeLog,
  updateChangeLogSchema,
} from '../controllers/changeLogController.js';
import {
  getSuperAdminOverview,
  grantCreditsSchema,
  grantDemoCredits,
  requestCreditsSchema,
  requestDemoCredits,
  updateAnyUserRole,
  updateSuperAdminRoleSchema,
} from '../controllers/superAdminController.js';
import { deleteKnowledgeDocument, listKnowledgeDocuments, uploadKnowledgeDocument } from '../controllers/ragController.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { knowledgeDocumentUpload } from '../middleware/knowledgeUpload.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const superAdminRouter = Router();

superAdminRouter.use(requireAuth);
superAdminRouter.post('/credits/request', validateRequest(requestCreditsSchema), requestDemoCredits);
superAdminRouter.get('/overview', authorize(roles.SUPER_ADMIN), getSuperAdminOverview);
superAdminRouter.patch('/users/:id/role', authorize(roles.SUPER_ADMIN), validateRequest(updateSuperAdminRoleSchema), updateAnyUserRole);
superAdminRouter.post('/users/:id/credits', authorize(roles.SUPER_ADMIN), validateRequest(grantCreditsSchema), grantDemoCredits);

// Architecture change log + technical backlog. Same superadmin gate as everything above — the
// literal /changelog/performance-series route is registered before /changelog/:id so it can't be
// swallowed by the param route.
superAdminRouter.get('/changelog/performance-series', authorize(roles.SUPER_ADMIN), getPerformanceSeries);
superAdminRouter.get('/changelog', authorize(roles.SUPER_ADMIN), listChangeLog);
superAdminRouter.post('/changelog', authorize(roles.SUPER_ADMIN), validateRequest(createChangeLogSchema), createChangeLog);
superAdminRouter.patch('/changelog/:id', authorize(roles.SUPER_ADMIN), validateRequest(updateChangeLogSchema), updateChangeLog);
superAdminRouter.get('/backlog', authorize(roles.SUPER_ADMIN), listBacklog);
superAdminRouter.post('/backlog', authorize(roles.SUPER_ADMIN), validateRequest(createBacklogSchema), createBacklog);
superAdminRouter.patch('/backlog/:id', authorize(roles.SUPER_ADMIN), validateRequest(updateBacklogSchema), updateBacklog);

// Knowledge Base — documents the AI agent retrieves from on every run. Vectors live in the Python
// agent service's Postgres/pgvector; these routes only broker the upload/list/delete.
superAdminRouter.get('/knowledge/documents', authorize(roles.SUPER_ADMIN), listKnowledgeDocuments);
superAdminRouter.post('/knowledge/documents', authorize(roles.SUPER_ADMIN), knowledgeDocumentUpload('file'), uploadKnowledgeDocument);
superAdminRouter.delete('/knowledge/documents/:id', authorize(roles.SUPER_ADMIN), deleteKnowledgeDocument);
