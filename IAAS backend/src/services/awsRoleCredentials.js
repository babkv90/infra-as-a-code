import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import '../config/env.js';

export function makeCredentials(stsCredentials) {
  if (!stsCredentials?.AccessKeyId || !stsCredentials?.SecretAccessKey) {
    throw new Error('Invalid AWS STS credentials received.');
  }

  return {
    accessKeyId: stsCredentials.AccessKeyId,
    secretAccessKey: stsCredentials.SecretAccessKey,
    sessionToken: stsCredentials.SessionToken,
  };
}

export function makeEnvCredentials() {
  const allowLocalReservedAwsEnv = !process.env.AWS_LAMBDA_FUNCTION_NAME;
  const accessKeyId = (
    process.env.INFRAFLOW_APP_AWS_ACCESS_KEY_ID ||
    process.env.INFRAFLOW_AWS_ACCESS_KEY_ID ||
    (allowLocalReservedAwsEnv ? process.env.AWS_ACCESS_KEY_ID : '') ||
    ''
  ).trim();
  const secretAccessKey = (
    process.env.INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY ||
    process.env.INFRAFLOW_AWS_SECRET_ACCESS_KEY ||
    (allowLocalReservedAwsEnv ? process.env.AWS_SECRET_ACCESS_KEY : '') ||
    ''
  ).trim();
  const sessionToken =
    (
      process.env.INFRAFLOW_APP_AWS_SESSION_TOKEN ||
      process.env.INFRAFLOW_AWS_SESSION_TOKEN ||
      (allowLocalReservedAwsEnv ? process.env.AWS_SESSION_TOKEN : '') ||
      ''
    ).trim() || undefined;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials are missing. Set INFRAFLOW_APP_AWS_ACCESS_KEY_ID and INFRAFLOW_APP_AWS_SECRET_ACCESS_KEY on the backend.');
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
  };
}

export async function assumeAwsRole(account = {}) {
  if (!account.roleArn) {
    return makeEnvCredentials();
  }

  if (account.roleArn.includes(':user/')) {
    throw new Error(
      `Invalid roleArn: ${account.roleArn}. sts:AssumeRole requires an IAM Role ARN, not an IAM User ARN.`,
    );
  }

  const sts = new STSClient({ region: 'us-east-1', credentials: makeEnvCredentials() });
  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: account.roleArn,
      RoleSessionName: `infraflow-${Date.now()}`,
      ExternalId: account.externalId || undefined,
      DurationSeconds: 3600,
    }),
  );

  return makeCredentials(response.Credentials);
}
