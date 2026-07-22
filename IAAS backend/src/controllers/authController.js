import crypto from 'crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { roles } from '../constants/roles.js';
import { getDashboardModulesForRole, getDashboardPermissionsForRole } from '../constants/dashboardModules.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { sendAuthTokens, signAccessToken, verifyRefreshToken } from '../utils/tokens.js';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    workspaceName: z.string().min(2).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: z.string().min(8),
  }),
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, workspaceName } = req.validated.body;
  const existing = await User.findOne({ email });

  if (existing) {
    throw new ApiError(409, 'A user with this email already exists');
  }

  const userCount = await User.estimatedDocumentCount();
  const role = userCount === 0 ? roles.OWNER : roles.VIEWER;
  const user = await User.create({ name, email, password, role });
  const workspace = await Workspace.create({
    name: workspaceName ?? `${name}'s workspace`,
    owner: user._id,
  });

  user.workspace = workspace._id;
  await user.save();

  const tokens = sendAuthTokens(res, user);
  await auditLog({ user, ip: req.ip }, 'auth.register', 'User', user._id, { role });

  res.status(201).json({
    success: true,
    data: {
      user: serializeUser(user, workspace),
      workspace,
      accessToken: tokens.accessToken,
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validated.body;
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new ApiError(403, 'User is not active');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = sendAuthTokens(res, user);
  await auditLog({ user, ip: req.ip }, 'auth.login', 'User', user._id);
  const workspace = await Workspace.findById(user.workspace);

  res.json({
    success: true,
    data: {
      user: serializeUser(user, workspace),
      accessToken: tokens.accessToken,
    },
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.validated.body;
  const user = await User.findOne({ email }).select('+passwordResetToken +passwordResetExpires');

  const responseBody = {
    success: true,
    message: 'If an account exists for this email, a password reset token has been generated.',
  };

  if (!user || user.status !== 'active') {
    return res.json(responseBody);
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = hashPasswordResetToken(resetToken);
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  await auditLog({ user, ip: req.ip }, 'auth.password_reset.requested', 'User', user._id);

  if (env.NODE_ENV !== 'production') {
    responseBody.data = {
      resetToken,
      expiresAt: user.passwordResetExpires,
    };
  }

  res.json(responseBody);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.validated.body;
  const passwordResetToken = hashPasswordResetToken(token);
  const user = await User.findOne({
    passwordResetToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+password +passwordResetToken +passwordResetExpires');

  if (!user || user.status !== 'active') {
    throw new ApiError(400, 'Password reset token is invalid or has expired');
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  res.clearCookie('refreshToken');
  await auditLog({ user, ip: req.ip }, 'auth.password_reset.completed', 'User', user._id);

  res.json({ success: true, message: 'Password has been reset. Please log in with your new password.' });
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken ?? req.body.refreshToken;

  if (!refreshToken) {
    throw new ApiError(401, 'Refresh token required');
  }

  const payload = verifyRefreshToken(refreshToken);
  const user = await User.findById(payload.sub);

  if (!user || user.status !== 'active') {
    throw new ApiError(401, 'Invalid refresh token');
  }

  res.json({
    success: true,
    data: {
      accessToken: signAccessToken(user),
      user: serializeUser(user, await Workspace.findById(user.workspace)),
    },
  });
});

export const me = asyncHandler(async (req, res) => {
  const workspace = await Workspace.findById(req.user.workspace);
  res.json({ success: true, data: { user: serializeUser(req.user, workspace), workspace } });
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie('refreshToken');
  res.json({ success: true, message: 'Logged out' });
});

function serializeUser(user, workspace) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    demoCredits: user.demoCredits ?? 0,
    creditRequest: user.creditRequest ?? { status: 'none' },
    accessPlan: workspace?.plan ?? 'free',
    workspacePlan: workspace?.plan ?? 'free',
    workspaceName: workspace?.name ?? '',
    dashboardAccess: {
      modules: getDashboardModulesForRole(user.role),
      permissions: getDashboardPermissionsForRole(user.role),
    },
    workspace: user.workspace,
    status: user.status,
  };
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
