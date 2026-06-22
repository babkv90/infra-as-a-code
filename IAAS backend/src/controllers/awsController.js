import { z } from 'zod';
import { awsRegions } from '../constants/awsRegions.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { getMockAwsInsights } from '../utils/awsInsightsMock.js';
import { syncAwsAccountData } from '../services/awsLiveSync.js';

export const createAwsAccountSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    accountId: z.string().min(6),
    roleArn: z.string().startsWith('arn:aws:iam::'),
    externalId: z.string().optional(),
    defaultRegion: z.enum(awsRegions).optional(),
  }),
});

export const listAwsRegions = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: awsRegions });
});

export const listAwsAccounts = asyncHandler(async (req, res) => {
  const accounts = await AwsAccount.find({ workspace: req.user.workspace }).sort({ createdAt: -1 });
  res.json({ success: true, data: accounts });
});

export const connectAwsAccount = asyncHandler(async (req, res) => {
  const account = await AwsAccount.create({
    ...req.validated.body,
    workspace: req.user.workspace,
    createdBy: req.user._id,
    status: 'pending',
    syncSummary: getMockAwsInsights(),
  });

  try {
    account.syncSummary = await syncAwsAccountData(account);
    account.accountId = account.syncSummary.identity?.accountId ?? account.accountId;
    account.status = 'connected';
    account.lastError = undefined;
    account.lastSyncAt = new Date();
    await account.save();
  } catch (error) {
    account.status = 'failed';
    account.lastError = error.message;
    await account.save();
    throw new ApiError(502, `AWS connection failed: ${error.message}`);
  }

  await auditLog(req, 'aws.connect', 'AwsAccount', account._id);
  res.status(201).json({ success: true, data: account });
});

export const syncAwsAccount = asyncHandler(async (req, res) => {
  const account = await AwsAccount.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!account) throw new ApiError(404, 'AWS account not found');

  try {
    account.syncSummary = await syncAwsAccountData(account);
    account.accountId = account.syncSummary.identity?.accountId ?? account.accountId;
    account.status = 'connected';
    account.lastError = undefined;
    account.lastSyncAt = new Date();
  } catch (error) {
    account.status = 'failed';
    account.lastError = error.message;
    await account.save();
    throw new ApiError(502, `AWS sync failed: ${error.message}`);
  }
  await account.save();

  await auditLog(req, 'aws.sync', 'AwsAccount', account._id);
  res.json({ success: true, data: account });
});

export const disconnectAwsAccount = asyncHandler(async (req, res) => {
  const account = await AwsAccount.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!account) throw new ApiError(404, 'AWS account not found');

  await AwsAccount.deleteOne({ _id: account._id });
  await auditLog(req, 'aws.disconnect', 'AwsAccount', account._id, {
    accountId: account.accountId,
    name: account.name,
  });

  res.json({ success: true, data: account });
});

export const getInsights = asyncHandler(async (req, res) => {
  const account = await AwsAccount.findOne({ workspace: req.user.workspace, status: 'connected' }).sort({ lastSyncAt: -1 });
  res.json({ success: true, data: account?.syncSummary ?? getMockAwsInsights() });
});
