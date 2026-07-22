import { z } from 'zod';
import { roles } from '../constants/roles.js';
import { AuditLog } from '../models/AuditLog.js';
import { Deployment } from '../models/Deployment.js';
import { Diagram } from '../models/Diagram.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { allowedServiceIdsForAccess, canUseAiAgent, serviceAccessTier } from '../utils/accessControl.js';

export const updateSuperAdminRoleSchema = z.object({
  body: z.object({
    role: z.enum(Object.values(roles)),
  }),
});

export const grantCreditsSchema = z.object({
  body: z.object({
    credits: z.number().int().min(0).max(1000),
    note: z.string().max(500).optional(),
  }),
});

export const requestCreditsSchema = z.object({
  body: z.object({
    requestedCredits: z.number().int().min(1).max(1000).default(5),
    reason: z.string().min(3).max(500),
  }),
});

export const getSuperAdminOverview = asyncHandler(async (_req, res) => {
  const [users, workspaces, diagramCounts, deploymentCounts, deployedCounts, latestLogs, recentActivities] = await Promise.all([
    User.find({}).sort({ createdAt: -1 }).lean(),
    Workspace.find({}).lean(),
    Diagram.aggregate([{ $group: { _id: '$createdBy', count: { $sum: 1 } } }]),
    Deployment.aggregate([{ $group: { _id: '$requestedBy', count: { $sum: 1 } } }]),
    Deployment.aggregate([{ $match: { status: 'deployed' } }, { $group: { _id: '$requestedBy', count: { $sum: 1 } } }]),
    AuditLog.aggregate([{ $sort: { createdAt: -1 } }, { $group: { _id: '$actor', lastActivityAt: { $first: '$createdAt' }, lastAction: { $first: '$action' } } }]),
    AuditLog.find({}).sort({ createdAt: -1 }).limit(30).populate('actor', 'name email role').lean(),
  ]);

  const workspaceById = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));
  const diagramsByUser = countMap(diagramCounts);
  const deploymentsByUser = countMap(deploymentCounts);
  const deployedByUser = countMap(deployedCounts);
  const latestByUser = new Map(latestLogs.map((entry) => [String(entry._id), entry]));

  const summaries = users.map((user) => {
    const workspace = workspaceById.get(String(user.workspace));
    const latest = latestByUser.get(String(user._id));
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      workspace: workspace
        ? {
            id: String(workspace._id),
            name: workspace.name,
            plan: workspace.plan,
          }
        : undefined,
      demoCredits: user.demoCredits ?? 0,
      creditRequest: user.creditRequest ?? { status: 'none' },
      accessTier: serviceAccessTier(user, workspace),
      allowedServices: allowedServiceIdsForAccess(user, workspace).size,
      aiEnabled: canUseAiAgent(user, workspace),
      diagramsCreated: diagramsByUser.get(String(user._id)) ?? 0,
      deploymentsCreated: deploymentsByUser.get(String(user._id)) ?? 0,
      successfulDeployments: deployedByUser.get(String(user._id)) ?? 0,
      lastActivityAt: latest?.lastActivityAt,
      lastAction: latest?.lastAction,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  });

  res.json({
    success: true,
    data: {
      totals: {
        users: summaries.length,
        diagrams: Array.from(diagramsByUser.values()).reduce((sum, value) => sum + value, 0),
        deployments: Array.from(deploymentsByUser.values()).reduce((sum, value) => sum + value, 0),
        pendingCreditRequests: summaries.filter((user) => user.creditRequest?.status === 'pending').length,
      },
      users: summaries,
      recentActivities: recentActivities.map((entry) => ({
        id: String(entry._id),
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        actor: entry.actor
          ? {
              id: String(entry.actor._id),
              name: entry.actor.name,
              email: entry.actor.email,
              role: entry.actor.role,
            }
          : undefined,
      })),
    },
  });
});

export const updateAnyUserRole = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');

  target.role = req.validated.body.role;
  await target.save();

  await auditLog(req, 'superadmin.user.role.update', 'User', target._id, { role: target.role });
  res.json({ success: true, data: { id: target._id, role: target.role } });
});

export const grantDemoCredits = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');

  target.demoCredits = req.validated.body.credits;
  target.creditRequest = {
    ...(target.creditRequest?.toObject?.() ?? target.creditRequest ?? {}),
    status: req.validated.body.credits > 0 ? 'granted' : 'none',
    reviewedAt: new Date(),
    reviewedBy: req.user._id,
    note: req.validated.body.note ?? '',
  };
  await target.save();

  await auditLog(req, 'superadmin.user.credits.grant', 'User', target._id, {
    credits: target.demoCredits,
    note: req.validated.body.note,
  });

  res.json({ success: true, data: { id: target._id, demoCredits: target.demoCredits, creditRequest: target.creditRequest } });
});

export const requestDemoCredits = asyncHandler(async (req, res) => {
  req.user.creditRequest = {
    status: 'pending',
    requestedCredits: req.validated.body.requestedCredits,
    reason: req.validated.body.reason,
    requestedAt: new Date(),
    note: '',
  };
  await req.user.save();

  await auditLog(req, 'credits.request', 'User', req.user._id, {
    requestedCredits: req.validated.body.requestedCredits,
    reason: req.validated.body.reason,
  });

  res.json({ success: true, data: { creditRequest: req.user.creditRequest } });
});

function countMap(items) {
  return new Map(items.filter((entry) => entry._id).map((entry) => [String(entry._id), entry.count]));
}
