import { Router } from 'express';
import {
  createDiagram,
  createDiagramSchema,
  deleteDiagram,
  exportTerraformById,
  getDiagram,
  listDiagrams,
  updateDiagram,
  updateDiagramSchema,
  validateDiagramById,
} from '../controllers/diagramController.js';
import { roles } from '../constants/roles.js';
import { requireAuth } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { validateRequest } from '../middleware/validateRequest.js';

export const diagramRouter = Router();

diagramRouter.use(requireAuth);
diagramRouter.get('/', listDiagrams);
diagramRouter.post('/', authorize(roles.ARCHITECT), validateRequest(createDiagramSchema), createDiagram);
diagramRouter.get('/:id', getDiagram);
diagramRouter.patch('/:id', authorize(roles.ARCHITECT), validateRequest(updateDiagramSchema), updateDiagram);
diagramRouter.delete('/:id', authorize(roles.ADMIN), deleteDiagram);
diagramRouter.post('/:id/validate', validateDiagramById);
diagramRouter.get('/:id/terraform', exportTerraformById);
