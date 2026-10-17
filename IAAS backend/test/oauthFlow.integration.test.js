// End-to-end "Sign in with Google" over real HTTP against a real MongoDB, with Google's token and
// JWKS endpoints faked in-process. The fake token endpoint enforces PKCE exactly as Google does
// (SHA256(code_verifier) must equal the code_challenge from /authorize), so a broken PKCE leg fails
// here too.
//
// Needs a MongoDB; skipped unless OAUTH_IT_MONGODB_URI is set, e.g.
//   OAUTH_IT_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
// It creates its own uniquely named database on that server and drops it afterwards — it never
// touches the database named in the URI.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';

const MONGO_URI = process.env.OAUTH_IT_MONGODB_URI;

if (!MONGO_URI) {
  test('OAuth sign-in integration flow', { skip: 'set OAUTH_IT_MONGODB_URI to run against a MongoDB' }, () => {});
} else {
  // env.js reads these at import time, so they're set before anything from src/ is loaded.
  process.env.GOOGLE_CLIENT_ID = 'it-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'it-secret';
  process.env.APP_BASE_URL = 'http://localhost:5173';

  const { default: express } = await import('express');
  const { default: cookieParser } = await import('cookie-parser');
  const { default: mongoose } = await import('mongoose');
  const { default: jwt } = await import('jsonwebtoken');
  const { authRouter } = await import('../src/routes/authRoutes.js');
  const { errorHandler } = await import('../src/middleware/errorHandler.js');
  const { User } = await import('../src/models/User.js');
  const { AuthIdentity } = await import('../src/models/AuthIdentity.js');
  const { OAuthLoginTicket } = await import('../src/models/OAuthLoginTicket.js');
  const { AuditLog } = await import('../src/models/AuditLog.js');

  // --- fake Google ---------------------------------------------------------------------------------
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'it', alg: 'RS256' };
  const grants = new Map(); // code -> { challenge, nonce, sub, email }
  const realFetch = globalThis.fetch;

  function fakeGoogle(url, init) {
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [jwk] }));
    const body = new URLSearchParams(init.body);
    const grant = grants.get(body.get('code'));
    grants.delete(body.get('code'));
    const verifierHash = crypto.createHash('sha256').update(String(body.get('code_verifier'))).digest('base64url');
    if (!grant || verifierHash !== grant.challenge) {
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }), { status: 400 });
    }
    const idToken = jwt.sign(
      { sub: grant.sub, email: grant.email, email_verified: true, name: 'Integration Person', nonce: grant.nonce },
      privateKey,
      { algorithm: 'RS256', keyid: 'it', audience: process.env.GOOGLE_CLIENT_ID, issuer: 'https://accounts.google.com', expiresIn: '5m' },
    );
    return new Response(JSON.stringify({ id_token: idToken, access_token: 'unused' }));
  }

  let server;
  let base;

  before(async () => {
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      return href.startsWith('https://www.googleapis.com/') || href.startsWith('https://oauth2.googleapis.com/')
        ? fakeGoogle(href, init)
        : realFetch(url, init);
    };
    await mongoose.connect(MONGO_URI, { dbName: `oauth_it_${crypto.randomBytes(4).toString('hex')}`, serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.syncIndexes(), AuthIdentity.syncIndexes(), OAuthLoginTicket.syncIndexes()]);

    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/v1/auth', authRouter);
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
    globalThis.fetch = realFetch;
  });

  const post = (path, body, headers = {}) =>
    realFetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const me = (token) => realFetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });

  // Drives /start → (fake consent) → /callback exactly as a browser would, and returns where the
  // callback sent the browser plus the verifier the SPA tab would hold.
  async function signInWithGoogle({ sub, email, tamperPkce = false, providerError } = {}) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const clientChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const start = await realFetch(
      `${base}/oauth/google/start?next=/dashboard&origin=http://localhost:5173&client_challenge=${clientChallenge}`,
      { redirect: 'manual' },
    );
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get('location'));
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const code = crypto.randomBytes(8).toString('hex');
    grants.set(code, {
      challenge: tamperPkce ? 'not-the-challenge' : authorize.searchParams.get('code_challenge'),
      nonce: authorize.searchParams.get('nonce'),
      sub,
      email,
    });
    const query = providerError ? `error=${providerError}` : `code=${code}`;
    const callback = await realFetch(`${base}/oauth/google/callback?${query}&state=${authorize.searchParams.get('state')}`, {
      redirect: 'manual',
      headers: { cookie },
    });
    assert.equal(callback.status, 302);
    const landing = new URL(callback.headers.get('location'));
    const fragment = new URLSearchParams(landing.hash.slice(1));
    return { landing, ticket: fragment.get('oauth_ticket'), next: fragment.get('next'), verifier };
  }

  test('new user: lands on /login with the ticket only in the fragment; exchange needs the right verifier and works once', async () => {
    const s = await signInWithGoogle({ sub: 'sub-new', email: 'new.person@example.com' });
    assert.equal(`${s.landing.origin}${s.landing.pathname}`, 'http://localhost:5173/login');
    assert.equal(s.landing.search, '', 'nothing sensitive in the query string');
    assert.ok(s.ticket);
    assert.equal(s.next, '/dashboard');

    assert.equal((await post('/oauth/exchange', { ticket: s.ticket, verifier: 'y'.repeat(43) })).status, 400);
    const exchanged = await post('/oauth/exchange', { ticket: s.ticket, verifier: s.verifier });
    assert.equal(exchanged.status, 200);
    assert.match(exchanged.headers.get('set-cookie') ?? '', /refreshToken=.*HttpOnly/i);
    const body = await exchanged.json();
    assert.equal(body.data.notice, null);
    assert.equal((await post('/oauth/exchange', { ticket: s.ticket, verifier: s.verifier })).status, 400, 'single use');

    const meResponse = await me(body.data.accessToken);
    assert.equal(meResponse.status, 200);
    assert.equal((await meResponse.json()).data.user.role, 'owner');
    const stored = await User.findOne({ email: 'new.person@example.com' }).select('+password');
    assert.equal(stored.password, undefined);
    assert.equal(stored.emailVerified, true);
    assert.ok(stored.workspace);
    assert.equal(await OAuthLoginTicket.countDocuments(), 0, 'redeemed tickets are deleted');
  });

  test('returning user: same subject signs in again, no duplicate account', async () => {
    const s = await signInWithGoogle({ sub: 'sub-new', email: 'new.person@example.com' });
    assert.equal((await post('/oauth/exchange', { ticket: s.ticket, verifier: s.verifier })).status, 200);
    assert.equal(await User.countDocuments({ email: 'new.person@example.com' }), 1);
  });

  test('two sign-ins in flight for the same person (two tabs/devices) are both redeemable', async () => {
    const first = await signInWithGoogle({ sub: 'sub-new', email: 'new.person@example.com' });
    const second = await signInWithGoogle({ sub: 'sub-new', email: 'new.person@example.com' });
    assert.equal((await post('/oauth/exchange', { ticket: first.ticket, verifier: first.verifier })).status, 200);
    assert.equal((await post('/oauth/exchange', { ticket: second.ticket, verifier: second.verifier })).status, 200);
  });

  test('password login on a Google-only account explains what to do', async () => {
    const response = await post('/login', { email: 'new.person@example.com', password: 'whatever123' });
    assert.equal(response.status, 401);
    assert.match((await response.json()).message, /Google or GitHub/);
  });

  test('pre-account hijacking: attacker’s password and live session die, and the victim is told', async () => {
    const registered = await post('/register', { name: 'Attacker', email: 'victim@example.com', password: 'attacker-pass-1', acceptTerms: true });
    const attackerToken = (await registered.json()).data.accessToken;
    assert.equal((await me(attackerToken)).status, 200);

    const s = await signInWithGoogle({ sub: 'sub-victim', email: 'victim@example.com' });
    const exchanged = await post('/oauth/exchange', { ticket: s.ticket, verifier: s.verifier });
    assert.equal(exchanged.status, 200);
    assert.equal((await exchanged.json()).data.notice, 'password_removed');

    assert.equal((await me(attackerToken)).status, 401, 'attacker session revoked');
    assert.equal((await post('/login', { email: 'victim@example.com', password: 'attacker-pass-1' })).status, 401);
    const audit = await AuditLog.findOne({ action: 'auth.oauth.linked' });
    assert.equal(audit.metadata.passwordCleared, true);
  });

  test('failures come back as codes only — never as text the login page would display', async () => {
    const pkce = await signInWithGoogle({ sub: 'x', email: 'x@example.com', tamperPkce: true });
    assert.equal(pkce.landing.searchParams.get('oauth_error'), 'provider_error');
    assert.equal(pkce.ticket, null);

    const cancelled = await signInWithGoogle({ providerError: 'access_denied' });
    assert.equal(cancelled.landing.searchParams.get('oauth_error'), 'cancelled');

    const forged = await realFetch(`${base}/oauth/google/callback?code=abc&state=forged`, { redirect: 'manual' });
    assert.equal(new URL(forged.headers.get('location')).searchParams.get('oauth_error'), 'state_invalid');

    const unknown = await realFetch(`${base}/oauth/myspace/start?client_challenge=${'a'.repeat(43)}`, { redirect: 'manual' });
    assert.equal(unknown.status, 302);
    assert.equal(new URL(unknown.headers.get('location')).searchParams.get('oauth_error'), 'not_enabled');
  });
}
