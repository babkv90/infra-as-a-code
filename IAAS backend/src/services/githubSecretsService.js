import sodium from 'libsodium-wrappers';
import { ApiError } from '../utils/ApiError.js';

function githubApiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function encryptSecretValue(publicKeyBase64, secretValue) {
  await sodium.ready;
  const publicKey = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(secretValue), publicKey);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

export async function setGithubActionsSecret({ token, owner, repo, secretName, secretValue }) {
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = githubApiHeaders(token);

  const keyResponse = await fetch(`${apiBase}/actions/secrets/public-key`, { headers });
  const keyResult = await keyResponse.json().catch(async () => ({ message: await keyResponse.text() }));
  if (!keyResponse.ok) {
    throw new ApiError(keyResponse.status, secretsAccessErrorMessage(owner, repo, keyResult?.message));
  }

  const encryptedValue = await encryptSecretValue(keyResult.key, secretValue);

  const putResponse = await fetch(`${apiBase}/actions/secrets/${encodeURIComponent(secretName)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyResult.key_id }),
  });

  if (putResponse.status !== 201 && putResponse.status !== 204) {
    const result = await putResponse.json().catch(async () => ({ message: await putResponse.text() }));
    throw new ApiError(putResponse.status, secretsAccessErrorMessage(owner, repo, result?.message));
  }

  return { secretName, updated: putResponse.status === 204 };
}

function secretsAccessErrorMessage(owner, repo, githubMessage) {
  if (String(githubMessage ?? '').toLowerCase().includes('not accessible by integration')) {
    return (
      `GitHub blocked infraflow from managing Actions secrets on ${owner}/${repo}. This means either: ` +
      '(1) the connected GitHub account has push/write access to this repo but not admin access — Actions ' +
      'secrets require admin, or (2) this repo belongs to an organization that restricts OAuth app access ' +
      '(an org owner must approve infraflow under Organization Settings → Third-party Access). Ask a repo ' +
      'admin to add the AWS_DEPLOY_ROLE_ARN secret manually using deploy/README.md, or grant admin access and retry.'
    );
  }
  return `Could not set GitHub Actions secret: ${githubMessage ?? 'unknown error'}`;
}
