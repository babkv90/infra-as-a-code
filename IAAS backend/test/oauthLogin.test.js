import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { AuthIdentity } from '../src/models/AuthIdentity.js';
import { OAuthLoginTicket } from '../src/models/OAuthLoginTicket.js';
import { User } from '../src/models/User.js';
import { Workspace } from '../src/models/Workspace.js';
import { resetGoogleKeyCacheForTests, verifyGoogleIdToken } from '../src/services/oauthProviders.js';
import { env } from '../src/config/env.js';
import {
  allowedAppOrigin,
  createOAuthTransaction,
  hashTicket,
  issueLoginTicket,
  oauthTxCookieName,
  isPkceChallenge,
  pkceChallenge,
  readOAuthTransaction,
  redeemLoginTicket,
  resolveOAuthUser,
  safeReturnTo,
} from '../src/services/oauthLogin.js';

// --- PKCE / return paths ------------------------------------------------------------------------

test('pkceChallenge: matches the RFC 7636 Appendix B test vector', () => {
  assert.equal(
    pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  assert.equal(isPkceChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'), true);
  assert.equal(isPkceChallenge('too-short'), false);
  assert.equal(isPkceChallenge(['E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM']), false);
});

test('safeReturnTo: only same-app relative paths survive', () => {
  assert.equal(safeReturnTo('/dashboard?tab=agent'), '/dashboard?tab=agent');
  assert.equal(safeReturnTo('//evil.example/x'), '/dashboard');
  assert.equal(safeReturnTo('/\\evil.example'), '/dashboard');
  assert.equal(safeReturnTo('https://evil.example'), '/dashboard');
  assert.equal(safeReturnTo(undefined), '/dashboard');
});

test('allowedAppOrigin: exact allowlist match only; anything else falls back to APP_BASE_URL', () => {
  const fallback = new URL(env.APP_BASE_URL).origin;
  const listed = new URL(env.CLIENT_ORIGINS[0]).origin;
  assert.equal(allowedAppOrigin(`${listed}/some/path`), listed);
  // Anyone can deploy to *.vercel.app — an origin not listed in CLIENT_ORIGINS is never a redirect target.
  assert.equal(allowedAppOrigin('https://attacker.vercel.app'), fallback);
  assert.equal(allowedAppOrigin('javascript:alert(1)'), fallback);
  assert.equal(allowedAppOrigin(undefined), fallback);
});

test('allowedAppOrigin: a deployed server never redirects to localhost or plain http, even though CLIENT_ORIGINS lists them', () => {
  const fallback = new URL(env.APP_BASE_URL).origin;
  // env.js always merges these dev defaults into CLIENT_ORIGINS.
  assert.ok(env.CLIENT_ORIGINS.includes('http://localhost:5173'));
  assert.equal(allowedAppOrigin('http://localhost:5173', { deployed: false }), 'http://localhost:5173');
  assert.equal(allowedAppOrigin('http://localhost:5173', { deployed: true }), fallback);
  assert.equal(allowedAppOrigin('http://127.0.0.1:5173', { deployed: true }), fallback);
  const httpsListed = env.CLIENT_ORIGINS.find((origin) => origin.startsWith('https://'));
  assert.equal(allowedAppOrigin(httpsListed, { deployed: true }), new URL(httpsListed).origin);
});

test('oauthTxCookieName: plain name locally; __Host- prefix is reserved for deployed (HTTPS) servers', () => {
  assert.equal(oauthTxCookieName('google'), env.IS_DEPLOYED ? '__Host-infraflow_oauth_google' : 'infraflow_oauth_google');
});

// --- transaction cookie -----------------------------------------------------------------------------

test('transaction cookie: round-trips state, nonce, verifier, client challenge and return path', () => {
  const clientChallenge = pkceChallenge('client-verifier-value-that-is-long-enough-123456');
  const tx = createOAuthTransaction({ providerId: 'google', returnTo: '/settings', clientChallenge });
  const read = readOAuthTransaction({ cookieValue: tx.cookieValue, providerId: 'google', state: tx.state });

  assert.equal(read.returnTo, '/settings');
  assert.equal(read.clientChallenge, clientChallenge);
  assert.equal(read.nonce, tx.nonce);
  assert.equal(pkceChallenge(read.codeVerifier), tx.codeChallenge, 'the challenge sent to the provider must derive from the stored verifier');
});

test('transaction cookie: rejects a state that does not match (login CSRF)', () => {
  const tx = createOAuthTransaction({ providerId: 'google', returnTo: '/', clientChallenge: 'x'.repeat(43) });
  assert.throws(() => readOAuthTransaction({ cookieValue: tx.cookieValue, providerId: 'google', state: 'attacker-state' }), {
    statusCode: 400,
    details: { oauthCode: 'state_invalid' },
  });
  assert.throws(() => readOAuthTransaction({ cookieValue: tx.cookieValue, providerId: 'google', state: '' }), { statusCode: 400 });
});

test('transaction cookie: rejects a missing, tampered, or other-provider cookie', () => {
  const tx = createOAuthTransaction({ providerId: 'google', returnTo: '/', clientChallenge: 'x'.repeat(43) });
  assert.throws(() => readOAuthTransaction({ cookieValue: undefined, providerId: 'google', state: tx.state }), {
    statusCode: 400,
    details: { oauthCode: 'state_invalid' },
  });
  assert.throws(() => readOAuthTransaction({ cookieValue: `${tx.cookieValue}x`, providerId: 'google', state: tx.state }), { statusCode: 400 });
  assert.throws(() => readOAuthTransaction({ cookieValue: tx.cookieValue, providerId: 'github', state: tx.state }), { statusCode: 400 });
});

// --- Google ID token verification ---------------------------------------------------------------

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function googleToken(claims = {}, { kid = 'test-kid', key = privateKey } = {}) {
  return jwt.sign(
    {
      sub: '1234567890',
      email: 'Person@Example.com',
      email_verified: true,
      nonce: 'n-1',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    },
    key,
    { algorithm: 'RS256', keyid: kid, audience: CLIENT_ID, issuer: 'https://accounts.google.com' },
  );
}

async function withJwks(run) {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=600' } });
  };
  resetGoogleKeyCacheForTests();
  try {
    return await run(() => fetches);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('verifyGoogleIdToken: accepts a correctly signed token for this client and nonce, and caches the keys', async () => {
  await withJwks(async (fetchCount) => {
    const claims = await verifyGoogleIdToken(googleToken(), { nonce: 'n-1', clientId: CLIENT_ID });
    assert.equal(claims.sub, '1234567890');
    await verifyGoogleIdToken(googleToken(), { nonce: 'n-1', clientId: CLIENT_ID });
    assert.equal(fetchCount(), 1, 'second verification must reuse the cached JWKS');
  });
});

test('verifyGoogleIdToken: rejects wrong audience, wrong nonce, expired, and foreign-key tokens', async () => {
  await withJwks(async () => {
    const opts = { nonce: 'n-1', clientId: CLIENT_ID };
    await assert.rejects(verifyGoogleIdToken(googleToken(), { ...opts, clientId: 'some-other-app' }), { statusCode: 401 });
    await assert.rejects(verifyGoogleIdToken(googleToken({ nonce: 'replayed' }), opts), { statusCode: 401 });
    await assert.rejects(verifyGoogleIdToken(googleToken({ exp: Math.floor(Date.now() / 1000) - 3600 }), opts), { statusCode: 401 });
    const { privateKey: attackerKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    await assert.rejects(verifyGoogleIdToken(googleToken({}, { key: attackerKey }), opts), { statusCode: 401 });
    await assert.rejects(verifyGoogleIdToken(googleToken({}, { kid: 'unknown-kid' }), opts), { statusCode: 401 });
  });
});

test('verifyGoogleIdToken: rejects alg=none and HS256 algorithm-confusion tokens', async () => {
  await withJwks(async () => {
    const opts = { nonce: 'n-1', clientId: CLIENT_ID };
    const unsigned = jwt.sign({ sub: '1', nonce: 'n-1', aud: CLIENT_ID, iss: 'https://accounts.google.com' }, '', {
      algorithm: 'none',
      keyid: 'test-kid',
    });
    await assert.rejects(verifyGoogleIdToken(unsigned, opts), { statusCode: 401 });
    const hmac = jwt.sign({ sub: '1', nonce: 'n-1', aud: CLIENT_ID, iss: 'https://accounts.google.com' }, 'guessable', {
      algorithm: 'HS256',
      keyid: 'test-kid',
    });
    await assert.rejects(verifyGoogleIdToken(hmac, opts), { statusCode: 401 });
  });
});

test('provider calls: carry an abort signal, and a timeout/network failure becomes a provider_error (no hang)', async () => {
  const originalFetch = globalThis.fetch;
  let sawSignal = false;
  globalThis.fetch = async (_url, init) => {
    sawSignal = init?.signal instanceof AbortSignal;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  resetGoogleKeyCacheForTests();
  try {
    await assert.rejects(verifyGoogleIdToken(googleToken(), { nonce: 'n-1', clientId: CLIENT_ID }), (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.details.oauthCode, 'provider_error');
      assert.match(error.message, /timed out/);
      return true;
    });
    assert.equal(sawSignal, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- account resolution (mocked Mongoose) --------------------------------------------------------

function fakeUser(fields) {
  return { _id: 'u1', status: 'active', sessionVersion: 0, saves: 0, async save() { this.saves += 1; }, ...fields };
}

async function withModelMocks({ identity = null, identityUser = null, emailUser = null }, run) {
  const originals = {
    identityFindOne: AuthIdentity.findOne,
    identityCreate: AuthIdentity.create,
    userFindOne: User.findOne,
    userFindById: User.findById,
    userCreate: User.create,
    workspaceCreate: Workspace.create,
  };
  const calls = { identityCreate: [], userCreate: [], workspaceCreate: [] };
  AuthIdentity.findOne = async () => identity;
  AuthIdentity.create = async (doc) => { calls.identityCreate.push(doc); return doc; };
  User.findById = async () => identityUser;
  User.findOne = () => ({ select: async () => emailUser });
  User.create = async (doc) => { calls.userCreate.push(doc); return fakeUser({ ...doc, _id: 'new-user' }); };
  Workspace.create = async (doc) => { calls.workspaceCreate.push(doc); return { _id: 'ws-new', ...doc }; };
  try {
    return await run(calls);
  } finally {
    AuthIdentity.findOne = originals.identityFindOne;
    AuthIdentity.create = originals.identityCreate;
    User.findOne = originals.userFindOne;
    User.findById = originals.userFindById;
    User.create = originals.userCreate;
    Workspace.create = originals.workspaceCreate;
  }
}

const verifiedProfile = { subject: 'g-1', email: 'person@example.com', emailVerified: true, name: 'Person', avatarUrl: '' };

test('resolveOAuthUser: a known (provider, subject) signs straight in — email is not consulted', async () => {
  const existing = fakeUser({});
  const identity = { userId: 'u1', email: 'old@example.com', async save() {} };
  await withModelMocks({ identity, identityUser: existing }, async (calls) => {
    const result = await resolveOAuthUser({ providerId: 'google', profile: { ...verifiedProfile, email: 'renamed@example.com' }, ip: '1.1.1.1' });
    assert.equal(result.outcome, 'login');
    assert.equal(result.user, existing);
    assert.equal(identity.email, 'renamed@example.com');
    assert.equal(calls.identityCreate.length, 0);
  });
});

test('resolveOAuthUser: refuses to link or create from an unverified provider email', async () => {
  await withModelMocks({}, async () => {
    await assert.rejects(
      resolveOAuthUser({ providerId: 'github', profile: { ...verifiedProfile, emailVerified: false }, ip: '1.1.1.1' }),
      { statusCode: 403, details: { oauthCode: 'email_unverified' } },
    );
  });
});

test('resolveOAuthUser: linking to an unverified password account clears the password and revokes sessions', async () => {
  const existing = fakeUser({ password: '$2a$12$hash', emailVerified: false, sessionVersion: 3 });
  await withModelMocks({ emailUser: existing }, async (calls) => {
    const result = await resolveOAuthUser({ providerId: 'google', profile: verifiedProfile, ip: '1.1.1.1' });
    assert.equal(result.outcome, 'linked');
    assert.equal(result.passwordCleared, true);
    assert.equal(existing.password, undefined);
    assert.equal(existing.sessionVersion, 4);
    assert.equal(existing.emailVerified, true);
    assert.equal(calls.identityCreate[0].subject, 'g-1');
  });
});

test('resolveOAuthUser: linking to an already-verified account keeps its password and sessions', async () => {
  const existing = fakeUser({ password: '$2a$12$hash', emailVerified: true, sessionVersion: 3 });
  await withModelMocks({ emailUser: existing }, async () => {
    const result = await resolveOAuthUser({ providerId: 'google', profile: verifiedProfile, ip: '1.1.1.1' });
    assert.equal(result.passwordCleared, false);
    assert.equal(existing.password, '$2a$12$hash');
    assert.equal(existing.sessionVersion, 3);
  });
});

test('resolveOAuthUser: a disabled account is not signed in by linking', async () => {
  await withModelMocks({ emailUser: fakeUser({ status: 'disabled' }) }, async () => {
    await assert.rejects(resolveOAuthUser({ providerId: 'google', profile: verifiedProfile, ip: '1.1.1.1' }), {
      statusCode: 403,
      details: { oauthCode: 'account_inactive' },
    });
  });
});

test('resolveOAuthUser: a new person gets a password-less owner account, workspace, and identity', async () => {
  await withModelMocks({}, async (calls) => {
    const result = await resolveOAuthUser({ providerId: 'github', profile: verifiedProfile, ip: '9.9.9.9' });
    assert.equal(result.outcome, 'registered');
    assert.equal(calls.userCreate[0].password, undefined);
    assert.equal(calls.userCreate[0].role, 'owner');
    assert.equal(calls.userCreate[0].emailVerified, true);
    assert.equal(calls.userCreate[0].legalConsent.acceptedIp, '9.9.9.9');
    assert.equal(calls.workspaceCreate[0].owner, 'new-user');
    assert.equal(result.user.workspace, 'ws-new');
    assert.equal(calls.identityCreate[0].provider, 'github');
  });
});

// --- login ticket ---------------------------------------------------------------------------------

async function withTicketMocks({ row = null, user = fakeUser({}) }, run) {
  const original = { create: OAuthLoginTicket.create, findOneAndDelete: OAuthLoginTicket.findOneAndDelete, findById: User.findById };
  const calls = { create: [], findOneAndDelete: [] };
  OAuthLoginTicket.create = async (doc) => { calls.create.push(doc); return doc; };
  OAuthLoginTicket.findOneAndDelete = async (filter) => { calls.findOneAndDelete.push(filter); return row; };
  User.findById = async () => user;
  try {
    return await run(calls);
  } finally {
    OAuthLoginTicket.create = original.create;
    OAuthLoginTicket.findOneAndDelete = original.findOneAndDelete;
    User.findById = original.findById;
  }
}

test('issueLoginTicket: stores only the hash, the challenge, the notice and a ~60 s expiry — one row per sign-in', async () => {
  await withTicketMocks({}, async (calls) => {
    const before = Date.now();
    const first = await issueLoginTicket({ _id: 'u1' }, 'c'.repeat(43), { notice: 'password_removed' });
    const second = await issueLoginTicket({ _id: 'u1' }, 'd'.repeat(43));
    assert.notEqual(first, second);
    assert.equal(calls.create.length, 2, 'a second sign-in must not overwrite the first');
    assert.equal(calls.create[0].ticketHash, hashTicket(first));
    assert.ok(!JSON.stringify(calls.create[0]).includes(first), 'raw ticket must never be stored');
    assert.equal(calls.create[0].notice, 'password_removed');
    assert.equal(calls.create[1].notice, null);
    const ttl = calls.create[0].expiresAt.getTime() - before;
    assert.ok(ttl > 55_000 && ttl <= 61_000, `expiry was ${ttl} ms`);
  });
});

test('redeemLoginTicket: one atomic find-and-delete on hash + verifier challenge + expiry, returns user and notice', async () => {
  await withTicketMocks({ row: { userId: 'u1', notice: 'password_removed' } }, async (calls) => {
    const verifier = 'v'.repeat(43);
    const { user, notice } = await redeemLoginTicket({ ticket: 'ticket-value', verifier });
    assert.equal(user._id, 'u1');
    assert.equal(notice, 'password_removed');
    assert.equal(calls.findOneAndDelete[0].ticketHash, hashTicket('ticket-value'));
    assert.equal(calls.findOneAndDelete[0].clientChallenge, pkceChallenge(verifier));
    assert.ok(calls.findOneAndDelete[0].expiresAt.$gt instanceof Date);
  });
});

test('redeemLoginTicket: a used, expired, or foreign-browser ticket matches nothing → 400 ticket_invalid', async () => {
  await withTicketMocks({ row: null }, async () => {
    await assert.rejects(redeemLoginTicket({ ticket: 'used', verifier: 'v'.repeat(43) }), {
      statusCode: 400,
      details: { oauthCode: 'ticket_invalid' },
    });
  });
});

test('redeemLoginTicket: a user disabled between callback and exchange is refused', async () => {
  await withTicketMocks({ row: { userId: 'u1', notice: null }, user: fakeUser({ status: 'disabled' }) }, async () => {
    await assert.rejects(redeemLoginTicket({ ticket: 't', verifier: 'v'.repeat(43) }), { statusCode: 403 });
  });
});
