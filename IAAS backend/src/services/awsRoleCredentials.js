import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

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
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN || undefined;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials are missing. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the backend .env file.');
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
