import {
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { env } from '../config/env.js';
import { makeEnvCredentials } from './awsRoleCredentials.js';

function client() {
  return new SecretsManagerClient({ region: env.SECRETS_MANAGER_REGION, credentials: makeEnvCredentials() });
}

// Creates the secret if `name` is new, otherwise pushes a new version onto the existing one — so
// re-applying a deployment (which regenerates the same resourceKey/attrKey pair) updates the secret
// in place instead of erroring or accumulating orphaned secrets. Returns the secret's ARN, which is
// all deployment.secretRefs ever stores.
export async function putSecret(name, value) {
  if (!env.SECRETS_MANAGER_ENABLED) {
    throw new Error('Secrets Manager is not enabled (set SECRETS_MANAGER_ENABLED=true on the backend).');
  }
  const sm = client();
  try {
    const created = await sm.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: value,
        KmsKeyId: env.SECRETS_MANAGER_KMS_KEY_ID || undefined,
      }),
    );
    return created.ARN;
  } catch (error) {
    if (!(error instanceof ResourceExistsException)) throw error;
    const updated = await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
    return updated.ARN;
  }
}

export async function getSecretValue(secretArn) {
  if (!env.SECRETS_MANAGER_ENABLED) {
    throw new Error('Secrets Manager is not enabled (set SECRETS_MANAGER_ENABLED=true on the backend).');
  }
  const sm = client();
  const result = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  return result.SecretString ?? '';
}
