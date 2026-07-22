import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const githubAuthorizeUrl = 'https://github.com/login/oauth/authorize';
const githubTokenUrl = 'https://github.com/login/oauth/access_token';
const githubApiUrl = 'https://api.github.com';
const stateExpiresIn = '10m';
const githubOAuthScope = 'read:user repo user:email workflow';

export function assertGithubOAuthConfigured() {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new ApiError(500, 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
  }
}

export function createGithubOAuthState({ userId, mode = 'redirect', returnTo = '/settings' }) {
  return jwt.sign(
    {
      type: 'github_oauth_state',
      sub: String(userId),
      mode,
      returnTo,
      nonce: crypto.randomBytes(16).toString('hex'),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: stateExpiresIn },
  );
}

export function verifyGithubOAuthState(state) {
  try {
    const payload = jwt.verify(String(state ?? ''), env.JWT_ACCESS_SECRET);
    if (payload.type !== 'github_oauth_state' || !payload.sub) throw new Error('Invalid state payload');
    return payload;
  } catch {
    throw new ApiError(400, 'Invalid or expired GitHub OAuth state.');
  }
}

export function githubAuthorizeRedirectUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: githubOAuthScope,
    state,
  });

  return `${githubAuthorizeUrl}?${params.toString()}`;
}

export async function exchangeGithubCodeForToken({ code, redirectUri }) {
  const response = await fetch(githubTokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.access_token) {
    throw new ApiError(400, payload?.error_description || payload?.error || 'GitHub token exchange failed.');
  }

  return {
    accessToken: payload.access_token,
    scopes: parseScopes(response.headers.get('x-oauth-scopes') || payload.scope),
  };
}

export async function fetchGithubUserProfile(accessToken) {
  const response = await fetch(`${githubApiUrl}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, result?.message ?? 'GitHub API request failed.');
  return {
    profile: result,
    scopes: parseScopes(response.headers.get('x-oauth-scopes')),
  };
}

export async function githubJson(path, accessToken) {
  const response = await fetch(`${githubApiUrl}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, result?.message ?? 'GitHub API request failed.');
  return result;
}

export function encryptGithubAccessToken(accessToken) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', githubTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accessToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptGithubAccessToken(encryptedToken) {
  const value = String(encryptedToken ?? '');
  if (!value.startsWith('v1:')) return value;

  const [, iv, tag, encrypted] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', githubTokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

function parseScopes(value = '') {
  return String(value)
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function githubTokenKey() {
  const secret = env.GITHUB_TOKEN_ENCRYPTION_KEY || env.JWT_REFRESH_SECRET || env.JWT_ACCESS_SECRET;
  return crypto.createHash('sha256').update(secret).digest();
}
