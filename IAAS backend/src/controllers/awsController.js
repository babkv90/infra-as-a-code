import { IAMClient, ListRolesCommand } from '@aws-sdk/client-iam';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { z } from 'zod';
import { awsRegions } from '../constants/awsRegions.js';
import { AwsAccount } from '../models/AwsAccount.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { getMockAwsInsights } from '../utils/awsInsightsMock.js';
import { syncAwsAccountData } from '../services/awsLiveSync.js';
import { assumeAwsRole, makeEnvCredentials } from '../services/awsRoleCredentials.js';

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

// Lets the "Connect AWS account" UI show a correct, ready-to-paste trust policy for a new IAM role
// without hardcoding infraflow's own AWS identity — it's whatever this deployment's backend
// credentials actually resolve to, discovered live via STS instead of guessed/hand-typed.
export const getDeployerIdentity = asyncHandler(async (_req, res) => {
  try {
    const sts = new STSClient({ region: 'us-east-1', credentials: makeEnvCredentials() });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    res.json({ success: true, data: { arn: identity.Arn, accountId: identity.Account } });
  } catch (error) {
    throw new ApiError(502, `Could not resolve infraflow's AWS identity: ${error.message}`);
  }
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

// Lets the diagram builder offer a dropdown of the account's actual existing IAM roles, so a
// resource (Lambda, EC2, EKS, CodePipeline) can attach to a role that already exists in AWS instead
// of always having Terraform create a brand-new one — useful when the deploy credential doesn't
// have (or you don't want to grant it) full iam:CreateRole/TagRole permissions.
export const listAccountIamRoles = asyncHandler(async (req, res) => {
  const account = await AwsAccount.findOne({ _id: req.params.id, workspace: req.user.workspace });
  if (!account) throw new ApiError(404, 'AWS account not found');

  try {
    const credentials = await assumeAwsRole(account);
    const iam = new IAMClient({ region: 'us-east-1', credentials });
    const roles = [];
    let marker;
    do {
      const page = await iam.send(new ListRolesCommand({ Marker: marker, MaxItems: 200 }));
      roles.push(...(page.Roles ?? []).map((role) => ({ arn: role.Arn, roleName: role.RoleName, createDate: role.CreateDate })));
      marker = page.IsTruncated ? page.Marker : undefined;
    } while (marker);

    res.json({ success: true, data: roles.sort((a, b) => a.roleName.localeCompare(b.roleName)) });
  } catch (error) {
    throw new ApiError(502, `Could not list IAM roles: ${addAwsConnectionHint(error.message)}`);
  }
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
