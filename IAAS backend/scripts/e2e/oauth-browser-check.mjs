// Real-browser check of "Continue with Google": drives Chrome through the actual SPA and backend.
//
//   1. Start the frontend:   npm run dev            (repo root — must serve http://127.0.0.1:5173)
//   2. Run this:             OAUTH_IT_MONGODB_URI=mongodb://127.0.0.1:27017 npm run e2e:oauth-browser
//                            (IAAS backend/; set CHROME_PATH if Chrome isn't at the Windows default)
//
// It starts the real backend app on :4001 inside this process with Google's token/JWKS endpoints
// faked (PKCE still enforced), answers "Google's consent screen" by intercepting accounts.google.com
// in Chrome, and uses its own uniquely named database, dropped at the end. Set E2E_SCREENSHOT_DIR
// to also save a screenshot of each screen.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MONGO_URI = process.env.OAUTH_IT_MONGODB_URI;
if (!MONGO_URI) {
  console.error('Set OAUTH_IT_MONGODB_URI (e.g. mongodb://127.0.0.1:27017). A fresh database is created and dropped.');
  process.exit(2);
}
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Same site as the API on 127.0.0.1:4001, so the refresh cookie is sent (src/main.tsx redirects
// localhost here in dev for the same reason).
const SPA = 'http://127.0.0.1:5173';
const screenshotDir = process.env.E2E_SCREENSHOT_DIR || '';

process.env.GOOGLE_CLIENT_ID = 'browser-e2e.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'browser-e2e-secret';
process.env.GITHUB_LOGIN_CLIENT_ID = 'browser-e2e-gh';
process.env.GITHUB_LOGIN_CLIENT_SECRET = 'browser-e2e-gh-secret';
process.env.APP_BASE_URL = SPA;

const { default: mongoose } = await import('mongoose');
const { default: jwt } = await import('jsonwebtoken');
await mongoose.connect(MONGO_URI, { dbName: `oauth_browser_${crypto.randomBytes(4).toString('hex')}` });
const { app } = await import('../../src/app.js'); // connectDatabase() sees the open connection and reuses it

// --- fake Google token + JWKS endpoints ------------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'browser', alg: 'RS256' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.startsWith('https://www.googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (href.startsWith('https://oauth2.googleapis.com/token')) {
    const body = new URLSearchParams(init.body);
    // The fake consent screen encodes the grant into the code itself (see Fetch.requestPaused below).
    const grant = JSON.parse(Buffer.from(body.get('code'), 'base64url').toString());
    const pkceOk = crypto.createHash('sha256').update(String(body.get('code_verifier'))).digest('base64url') === grant.challenge;
    if (!pkceOk) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    const idToken = jwt.sign(
      { sub: grant.sub, email: grant.email, email_verified: true, name: grant.name, nonce: grant.nonce },
      privateKey,
      { algorithm: 'RS256', keyid: 'browser', audience: process.env.GOOGLE_CLIENT_ID, issuer: 'https://accounts.google.com', expiresIn: '5m' },
    );
    return new Response(JSON.stringify({ id_token: idToken, access_token: 'unused' }));
  }
  return realFetch(url, init);
};
const server = app.listen(4001);

// --- Chrome over the DevTools protocol -------------------------------------------------------------
const profileDir = mkdtempSync(path.join(os.tmpdir(), 'oauth-e2e-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profileDir}`, '--window-size=1280,900', '--no-first-run', 'about:blank']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let targets = [];
for (let i = 0; i < 40 && !targets.some((t) => t.type === 'page'); i++) {
  try { targets = await (await realFetch('http://127.0.0.1:9333/json/list')).json(); } catch { /* not up yet */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) listeners.forEach((fn) => fn(msg));
});
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expression, timeout = 20000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) if (await evaluate(expression)) return true;
  return false;
};
const navigate = async (url) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(150); await send('Page.navigate', { url }); };
const screenshot = async (name) => {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(screenshotDir, name), Buffer.from(result.data, 'base64'));
};

let identity = { sub: 'browser-sub-1', email: 'browser.person@example.com', name: 'Browser Person' };
listeners.push(async (msg) => {
  if (msg.method !== 'Fetch.requestPaused') return;
  const authorize = new URL(msg.params.request.url);
  const code = Buffer.from(JSON.stringify({ ...identity, challenge: authorize.searchParams.get('code_challenge'), nonce: authorize.searchParams.get('nonce') })).toString('base64url');
  const back = `${authorize.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(authorize.searchParams.get('state'))}`;
  await send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 302, responseHeaders: [{ name: 'Location', value: back }] });
});
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://accounts.google.com/*', requestStage: 'Request' }] });

let failures = 0;
const check = (label, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`); };
const clickGoogle = () => evaluate(`[...document.querySelectorAll('.auth-oauth-button')].find((b) => b.textContent.includes('Google')).click()`);

try {
  await navigate(`${SPA}/login?next=/dashboard`);
  check('login page renders Google + GitHub buttons', await waitFor(`document.querySelectorAll('.auth-oauth-button').length === 2`));
  await screenshot('01-login.png');

  await clickGoogle();
  check('Google round trip ends on /dashboard', await waitFor(`location.pathname === '/dashboard'`, 30000), await evaluate('location.href'));
  check('signed in as the Google identity', (await evaluate(`JSON.parse(localStorage.getItem('infra-auth-user') || '{}').email`)) === identity.email);
  check('tab verifier consumed', (await evaluate(`sessionStorage.getItem('infra-oauth-verifier')`)) === null);
  check('no ticket left in the URL', !(await evaluate('location.href')).includes('oauth_ticket'));
  await sleep(1500);
  await screenshot('02-dashboard.png');

  // The access token is held in memory only (src/auth/authClient.ts); the httpOnly refresh cookie
  // is what carries the session across a reload.
  const jwtInStorage = `[localStorage, sessionStorage].some((s) => Object.keys(s).some((k) => /eyJ[\\w-]+\\.eyJ/.test(s.getItem(k) || '')))`;
  check('no JWT in localStorage or sessionStorage', (await evaluate(jwtInStorage)) === false);
  await navigate(`${SPA}/dashboard`);
  check('reload stays signed in via the refresh cookie', await waitFor(`import('/src/auth/authClient.ts').then((m) => !!m.getAccessToken())`));
  await sleep(1000);
  check('…and is still on /dashboard', (await evaluate('location.pathname')) === '/dashboard', await evaluate('location.href'));
  check('…still with no JWT in storage', (await evaluate(jwtInStorage)) === false);
  check(
    'an expired access token is refreshed and the request retried',
    await evaluate(`(async () => {
      const auth = await import('/src/auth/authClient.ts');
      const api = await import('/src/utils/apiClient.ts');
      auth.storeAuthSession('expired.access.token', auth.getStoredUser());
      const me = await api.apiRequest('/auth/me');
      return me?.user?.email === ${JSON.stringify(identity.email)} && auth.getAccessToken() !== 'expired.access.token';
    })()`),
  );
  await evaluate(`localStorage.clear()`);

  await navigate(`${SPA}/login?oauth_error=cancelled`);
  check('error code mapped to fixed wording', await waitFor(`document.body.innerText.includes('Sign-in was cancelled.')`));
  check('error param stripped from the URL', (await evaluate('location.search')) === '');
  await navigate(`${SPA}/login?oauth_error=${encodeURIComponent('Your account is locked. Call +1 555 0100 now.')}`);
  check('crafted text in ?oauth_error= is never displayed', await waitFor(`document.body.innerText.includes('Sign-in failed. Please try again.')`) && !(await evaluate(`document.body.innerText.includes('555 0100')`)));
  await screenshot('03-crafted-error.png');

  await navigate(`${SPA}/login#oauth_ticket=${'A'.repeat(43)}&next=%2Fdashboard`);
  check('ticket planted in a fresh tab is refused', await waitFor(`document.body.innerText.includes('different tab or browser')`));

  // Pre-account hijacking: someone registered this email with a password first.
  await realFetch('http://127.0.0.1:4001/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Attacker', email: 'victim@example.com', password: 'attacker-pass-1', acceptTerms: true }),
  });
  identity = { sub: 'browser-sub-victim', email: 'victim@example.com', name: 'Real Victim' };
  await navigate(`${SPA}/login?next=/dashboard`);
  await waitFor(`document.querySelectorAll('.auth-oauth-button').length === 2`);
  await clickGoogle();
  check('victim sees the "password removed" notice before continuing', await waitFor(`!!document.querySelector('.auth-oauth-notice')`, 30000));
  check('…and stays on /login until they choose to continue', (await evaluate('location.pathname')) === '/login');
  await screenshot('04-password-removed-notice.png');
  await evaluate(`document.querySelector('.auth-oauth-notice button').click()`);
  check('Continue goes to /dashboard', await waitFor(`location.pathname === '/dashboard'`));

  // Email + password login goes through the same in-memory session.
  await realFetch('http://127.0.0.1:4001/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Password Person', email: 'password.person@example.com', password: 'password-pass-1', acceptTerms: true }),
  });
  await evaluate(`import('/src/auth/authClient.ts').then((m) => m.login({ email: 'password.person@example.com', password: 'password-pass-1' }))`);
  check('password login keeps the JWT out of storage', (await evaluate(jwtInStorage)) === false);
  await navigate(`${SPA}/dashboard`);
  check('password session survives a reload', await waitFor(`import('/src/auth/authClient.ts').then((m) => m.getAccessToken() && m.getStoredUser()?.email === 'password.person@example.com')`));
  await evaluate(`import('/src/auth/authClient.ts').then((m) => m.logout())`);
  await navigate(`${SPA}/dashboard`);
  check('after logout a reload lands on /login', await waitFor(`location.pathname === '/login'`));

  await evaluate(`localStorage.setItem('codemanus-ui-experience', 'classic'); localStorage.removeItem('infra-auth-user')`);
  await navigate(`${SPA}/login`);
  check('Classic experience renders the buttons too', await waitFor(`document.querySelectorAll('.auth-oauth-button').length === 2`));
  await screenshot('05-login-classic.png');
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  await sleep(500);
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
