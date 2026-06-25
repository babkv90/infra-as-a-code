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
  let account = await AwsAccount.findOne({
    workspace: req.user.workspace,
    accountId: req.validated.body.accountId,
  });
  let isReconnect = Boolean(account);

  if (!account) {
    account = new AwsAccount({
      workspace: req.user.workspace,
      createdBy: req.user._id,
      syncSummary: getMockAwsInsights(),
    });
  }

  account.set({
    ...req.validated.body,
    status: 'pending',
    lastError: undefined,
  });

  try {
    account.syncSummary = await syncAwsAccountData(account);
    const syncedAccountId = account.syncSummary.identity?.accountId;
    if (syncedAccountId && syncedAccountId !== account.accountId) {
      const accountWithSyncedId = await AwsAccount.findOne({
        _id: { $ne: account._id },
        workspace: req.user.workspace,
        accountId: syncedAccountId,
      });

      if (accountWithSyncedId) {
        await AwsAccount.deleteOne({ _id: account._id });
        accountWithSyncedId.set({
          ...req.validated.body,
          accountId: syncedAccountId,
          status: 'connected',
          lastError: undefined,
          syncSummary: account.syncSummary,
          lastSyncAt: new Date(),
        });
        account = accountWithSyncedId;
        isReconnect = true;
      } else {
        account.accountId = syncedAccountId;
      }
    }
    account.status = 'connected';
    account.lastError = undefined;
    account.lastSyncAt = new Date();
    await account.save();
  } catch (error) {
    account.status = 'failed';
    account.lastError = addAwsConnectionHint(error.message);
    await account.save();
    throw new ApiError(502, `AWS connection failed: ${addAwsConnectionHint(error.message)}`);
  }

  await auditLog(req, isReconnect ? 'aws.reconnect' : 'aws.connect', 'AwsAccount', account._id);
  res.status(isReconnect ? 200 : 201).json({ success: true, data: account });
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
    account.lastError = addAwsConnectionHint(error.message);
    await account.save();
    throw new ApiError(502, `AWS sync failed: ${addAwsConnectionHint(error.message)}`);
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

function addAwsConnectionHint(message = '') {
  if (String(message).toLowerCase().includes('security token included in the request is invalid')) {
    return `${message} Check IAAS backend/.env: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must belong to an active IAM user or valid temporary session that can call STS. If the access key starts with ASIA, AWS_SESSION_TOKEN is required. If you changed .env, restart the backend.`;
  }

  return message;
}
