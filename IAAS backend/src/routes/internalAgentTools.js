import { Router } from 'express';
import {
  fixChangesValidation,
  fixFinishValidation,
  fixPlanValidation,
  fixStateValidation,
  getFixState,
  getGrounding,
  groundingValidation,
  postFixChanges,
  postFixFinish,
  postFixPlan,
  postRunComplete,
  postRunStep,
  runCompleteValidation,
  runStepValidation,
} from '../controllers/internalAgentToolsController.js';
import { requireAgentScope } from '../middleware/requireAgentScope.js';

// Machine-JWT-only surface (see requireAgentScope.js) — never mounted behind requireAuth. This is
// the tool gateway from infraflow-multi-agent-plan.pdf §0/§1.7: the Python agent service's only
// way to read diagram/Terraform/validation/billing state and report run progress, scoped per-run
// by the token's own workspace (and, for the run-report routes, its own runId — see assertOwnRun
// in the controller).
export const internalAgentToolsRouter = Router();

internalAgentToolsRouter.post('/grounding', requireAgentScope('diagram:read'), groundingValidation, getGrounding);
internalAgentToolsRouter.post('/runs/:runId/steps', requireAgentScope(), runStepValidation, postRunStep);
internalAgentToolsRouter.post('/runs/:runId/complete', requireAgentScope(), runCompleteValidation, postRunComplete);

// Plan-fix agent tools — see services/agentPlanFix.js. Scoped to tokens minted for plan_fix runs.
internalAgentToolsRouter.post('/runs/:runId/fix/state', requireAgentScope('diagram:read'), fixStateValidation, getFixState);
internalAgentToolsRouter.post('/runs/:runId/fix/changes', requireAgentScope('diagram:draft:write'), fixChangesValidation, postFixChanges);
internalAgentToolsRouter.post('/runs/:runId/fix/plan', requireAgentScope('terraform:plan'), fixPlanValidation, postFixPlan);
internalAgentToolsRouter.post('/runs/:runId/fix/finish', requireAgentScope('diagram:draft:write'), fixFinishValidation, postFixFinish);
