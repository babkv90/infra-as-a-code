import { z } from 'zod';
import { getDashboardModulesForRole, getDashboardPermissionsForRole } from '../constants/dashboardModules.js';
import { roles } from '../constants/roles.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';

export const updateUserRoleSchema = z.object({
  body: z.object({
    role: z.enum(Object.values(roles)),
  }),
});

export const updateUserStatusSchema = z.object({
  body: z.object({
    status: z.enum(['active', 'disabled']),
  }),
});

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ workspace: req.user.workspace }).sort({ createdAt: -1 });
  res.json({ success: true, data: users.map(serializeUser) });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!user) throw new ApiError(404, 'User not found');

  user.role = req.validated.body.role;
  await user.save();

  await auditLog(req, 'user.role.update', 'User', user._id, { role: user.role });
  res.json({ success: true, data: serializeUser(user) });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    throw new ApiError(409, 'You cannot disable your own account');
  }

  const user = await User.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!user) throw new ApiError(404, 'User not found');

  user.status = req.validated.body.status;
  await user.save();

  await auditLog(req, 'user.status.update', 'User', user._id, { status: user.status });
  res.json({ success: true, data: serializeUser(user) });
});

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    dashboardAccess: {
      modules: getDashboardModulesForRole(user.role),
      permissions: getDashboardPermissionsForRole(user.role),
    },
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
