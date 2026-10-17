import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env, oauthStateSecretUsable } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Every provider is reduced to the same three steps — build the authorize URL, swap the code for
// tokens, turn those into a normalized profile — so oauthController.js never branches on provider.
// Normalized profile: { subject, email, emailVerified, name, avatarUrl }.

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GITHUB_API_URL = 'https://api.github.com';
// Every call to Google/GitHub is bounded: a slow provider must fail this one sign-in quickly, not
// hold the Lambda until its own timeout.
const PROVIDER_TIMEOUT_MS = 10_000;

// Errors raised during sign-in carry a short code (details.oauthCode). The callback redirects with
// only that code and the login page maps it to fixed wording — no message text ever travels
// through a URL, so nobody can make our login page display words of their choosing.
export function oauthError(statusCode, code, message) {
  return new ApiError(statusCode, message, { oauthCode: code });
}

export const oauthProviders = {
  google: {
    id: 'google',
    name: 'Google',
    isConfigured: () => oauthStateSecretUsable && Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    authorizeUrl({ redirectUri, state, nonce, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        // openid makes this OpenID Connect: the token response then includes a signed id_token.
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },
    async fetchProfile({ code, redirectUri, codeVerifier, nonce }) {
      const response = await providerFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
      });
      const tokens = await response.json().catch(() => null);
      if (!response.ok || !tokens?.id_token) {
        throw oauthError(502, 'provider_error', `Google token exchange failed: ${tokens?.error_description || tokens?.error || response.status}`);
      }

      const claims = await verifyGoogleIdToken(tokens.id_token, { nonce });
      return {
        subject: String(claims.sub),
        email: String(claims.email ?? '').toLowerCase(),
        emailVerified: claims.email_verified === true,
        name: claims.name ?? '',
        avatarUrl: claims.picture ?? '',
      };
    },
  },

  github: {
    id: 'github',
    name: 'GitHub',
    isConfigured: () => oauthStateSecretUsable && Boolean(env.GITHUB_LOGIN_CLIENT_ID && env.GITHUB_LOGIN_CLIENT_SECRET),
    authorizeUrl({ redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: env.GITHUB_LOGIN_CLIENT_ID,
        redirect_uri: redirectUri,
        // Identity only. Repo/workflow access is a separate, explicit consent on the settings page.
        scope: 'read:user user:email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        allow_signup: 'true',
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    },
    async fetchProfile({ code, redirectUri, codeVerifier }) {
      const response = await providerFetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_LOGIN_CLIENT_ID,
          client_secret: env.GITHUB_LOGIN_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      const tokens = await response.json().catch(() => null);
      if (!response.ok || !tokens?.access_token) {
        throw oauthError(502, 'provider_error', `GitHub token exchange failed: ${tokens?.error_description || tokens?.error || response.status}`);
      }

      // GitHub is plain OAuth 2.0, not OpenID Connect — there is no id_token, so identity comes from
      // calling its API with the access token. The token is used for these two calls and dropped.
      const [profile, emails] = await Promise.all([
        githubGet('/user', tokens.access_token),
        githubGet('/user/emails', tokens.access_token),
      ]);
      const verifiedEmails = Array.isArray(emails) ? emails.filter((entry) => entry?.verified && entry.email) : [];
      const chosen = verifiedEmails.find((entry) => entry.primary) ?? verifiedEmails[0];

      return {
        subject: String(profile.id),
        email: String(chosen?.email ?? '').toLowerCase(),
        emailVerified: Boolean(chosen),
        name: profile.name || profile.login || '',
        avatarUrl: profile.avatar_url ?? '',
      };
    },
  },
};

export function getOAuthProvider(providerId) {
  const provider = Object.hasOwn(oauthProviders, providerId) ? oauthProviders[providerId] : undefined;
  if (!provider) throw oauthError(404, 'not_enabled', 'Unknown sign-in provider.');
  if (!provider.isConfigured()) throw oauthError(404, 'not_enabled', `${provider.name} sign-in is not enabled on this server.`);
  return provider;
}

export function listConfiguredOAuthProviders() {
  return Object.values(oauthProviders)
    .filter((provider) => provider.isConfigured())
    .map(({ id, name }) => ({ id, name }));
}

async function githubGet(path, accessToken) {
  const response = await providerFetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw oauthError(502, 'provider_error', `GitHub ${path} failed: ${result?.message ?? response.status}`);
  return result;
}

// --- Google ID token verification -----------------------------------------------------------------
// The id_token is a JWT signed by Google with RS256. Google publishes the matching public keys as a
// JWKS and rotates them; each token's header names its key by `kid`. Keys are cached for as long as
// Google's Cache-Control allows, and an unknown kid forces one refetch so a rotation is picked up
// immediately instead of failing every sign-in until the cache expires.

let googleKeyCache = { keys: new Map(), expiresAt: 0 };

export async function verifyGoogleIdToken(idToken, { nonce, clientId = env.GOOGLE_CLIENT_ID, now = Date.now() } = {}) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw oauthError(401, 'provider_error', 'Google ID token is malformed.');

  const publicKey = await googlePublicKey(decoded.header.kid, now);
  let claims;
  try {
    claims = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'], // pinned: never let the token's own header pick the algorithm
      audience: clientId, // issued to *this* app, not some other app's token replayed here
      issuer: GOOGLE_ISSUERS,
      clockTimestamp: Math.floor(now / 1000),
      clockTolerance: 30,
    });
  } catch (error) {
    throw oauthError(401, 'provider_error', `Google ID token rejected: ${error.message}`);
  }

  // Binds the token to the sign-in attempt this browser started (the nonce lives in its tx cookie),
  // so an id_token captured from some other sign-in can't be replayed into this one.
  if (!nonce || !claims.nonce || !safeEqual(claims.nonce, nonce)) {
    throw oauthError(401, 'provider_error', 'Google ID token nonce mismatch.');
  }
  return claims;
}

async function googlePublicKey(kid, now) {
  if (now >= googleKeyCache.expiresAt || !googleKeyCache.keys.has(kid)) {
    await refreshGoogleKeys(now);
  }
  const key = googleKeyCache.keys.get(kid);
  if (!key) throw oauthError(401, 'provider_error', 'Google ID token was signed with an unknown key.');
  return key;
}

async function refreshGoogleKeys(now) {
  const response = await providerFetch(GOOGLE_JWKS_URL);
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.keys)) throw oauthError(502, 'provider_error', 'Could not load Google signing keys.');

  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  googleKeyCache = {
    keys: new Map(body.keys.filter((jwk) => jwk.kid).map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })])),
    expiresAt: now + maxAge * 1000,
  };
}

async function providerFetch(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? `timed out after ${PROVIDER_TIMEOUT_MS} ms` : error?.message;
    throw oauthError(502, 'provider_error', `${new URL(url).host} unreachable: ${reason}`);
  }
}

export function resetGoogleKeyCacheForTests() {
  googleKeyCache = { keys: new Map(), expiresAt: 0 };
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
