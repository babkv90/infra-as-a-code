import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { currentLegalVersions } from '../constants/legalVersions.js';
import { roles } from '../constants/roles.js';
import { AuthIdentity } from '../models/AuthIdentity.js';
import { OAuthLoginTicket } from '../models/OAuthLoginTicket.js';
import { User } from '../models/User.js';
import { Workspace } from '../models/Workspace.js';
import { oauthError, safeEqual } from './oauthProviders.js';

const TX_TTL_SECONDS = 10 * 60;
const TICKET_TTL_MS = 60 * 1000;
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

// --- PKCE (RFC 7636) ------------------------------------------------------------------------------

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function isPkceChallenge(value) {
  return typeof value === 'string' && BASE64URL_43.test(value);
}

// --- Per-attempt transaction cookie ---------------------------------------------------------------
// /start generates state, nonce and the PKCE verifier and needs them again in the callback. They ride
// in a signed, httpOnly cookie on this API's own domain instead of a server-side session store (this
// runs on Lambda — there is no sticky memory between the two requests). Keeping `state` in a cookie
// is what defeats login CSRF: a callback URL crafted in an attacker's browser carries a state that
// doesn't match the victim's cookie, so it is rejected.

export function oauthTxCookieName(providerId) {
  // __Host- makes the browser itself enforce Secure + Path=/ + no Domain, so a sibling subdomain
  // can't plant or overwrite this cookie. Browsers only accept the prefix over HTTPS, hence deployed-only.
  return `${env.IS_DEPLOYED ? '__Host-' : ''}infraflow_oauth_${providerId}`;
}

export function oauthTxCookieOptions() {
  return {
    httpOnly: true,
    secure: env.IS_DEPLOYED,
    // Lax, not Strict: the callback arrives as a cross-site top-level GET redirect from
    // accounts.google.com / github.com, which Lax still sends cookies on and Strict would not.
    sameSite: 'lax',
    path: '/',
    maxAge: TX_TTL_SECONDS * 1000,
  };
}

export function createOAuthTransaction({ providerId, returnTo, clientChallenge, appOrigin }) {
  const codeVerifier = randomToken(32);
  const tx = {
    typ: 'oauth_tx',
    p: providerId,
    state: randomToken(24),
    nonce: randomToken(24),
    cv: codeVerifier,
    cc: clientChallenge,
    rt: returnTo,
    ao: appOrigin,
  };
  return {
    cookieValue: jwt.sign(tx, env.OAUTH_STATE_SECRET, { expiresIn: TX_TTL_SECONDS }),
    state: tx.state,
    nonce: tx.nonce,
    codeChallenge: pkceChallenge(codeVerifier),
  };
}

export function readOAuthTransaction({ cookieValue, providerId, state }) {
  let tx;
  try {
    tx = jwt.verify(String(cookieValue ?? ''), env.OAUTH_STATE_SECRET);
  } catch {
    throw oauthError(400, 'state_invalid', 'Transaction cookie missing, expired, or not signed by us.');
  }
  if (tx.typ !== 'oauth_tx' || tx.p !== providerId) {
    throw oauthError(400, 'state_invalid', 'Transaction cookie belongs to a different provider.');
  }
  if (!state || !safeEqual(tx.state, state)) {
    throw oauthError(400, 'state_invalid', 'state parameter does not match the transaction cookie.');
  }
  return { nonce: tx.nonce, codeVerifier: tx.cv, clientChallenge: tx.cc, returnTo: tx.rt, appOrigin: tx.ao };
}

// Where the callback sends the browser back to. The ticket in that redirect is a credential, so this
// is an exact-match allowlist (APP_BASE_URL + CLIENT_ORIGINS) — never a pattern, never whatever the
// request asked for. Sending the user back to the origin they started on matters because the SPA's
// half of the ticket binding lives in that origin's sessionStorage. On a real deployment plain-http
// and loopback origins are dropped: env.CLIENT_ORIGINS always carries the localhost dev defaults
// (readMergedList in config/env.js), and a deployed server has no business redirecting there.
export function allowedAppOrigin(requested, { deployed = env.IS_DEPLOYED } = {}) {
  const fallback = new URL(env.APP_BASE_URL).origin;
  const allowed = new Set(
    [fallback, ...env.CLIENT_ORIGINS].map((value) => originOf(value, { deployed })).filter(Boolean),
  );
  const origin = originOf(requested, { deployed });
  return origin && allowed.has(origin) ? origin : fallback;
}

function originOf(value, { deployed }) {
  try {
    const url = new URL(String(value ?? ''));
    if (deployed) {
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      return url.protocol === 'https:' && !loopback ? url.origin : '';
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

export function safeReturnTo(value, fallback = '/dashboard') {
  // Relative in-app paths only: '//evil.com' and '/\evil.com' are protocol-relative to browsers.
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value.slice(0, 240);
}

// --- Who is this? ---------------------------------------------------------------------------------

/**
 * Maps a provider profile onto a local user, in this order:
 *   1. An AuthIdentity already exists for (provider, subject)            → that user signs in.
 *   2. A user already exists with the same, provider-verified email      → link it, then sign in.
 *   3. Nobody                                                            → create user + workspace.
 * Returns { user, outcome: 'login' | 'linked' | 'registered', passwordCleared }.
 */
export async function resolveOAuthUser({ providerId, profile, ip }, { retried = false } = {}) {
  try {
    return await resolveOnce({ providerId, profile, ip });
  } catch (error) {
    // Two callbacks for the same brand-new account racing each other: the loser hits a unique index
    // (AuthIdentity provider+subject, or User email). By now the winner's rows exist — step 1 or 2
    // finds them on the retry.
    if (error?.code === 11000 && !retried) return resolveOAuthUser({ providerId, profile, ip }, { retried: true });
    throw error;
  }
}

async function resolveOnce({ providerId, profile, ip }) {
  const identity = await AuthIdentity.findOne({ provider: providerId, subject: profile.subject });
  if (identity) {
    const user = await User.findById(identity.userId);
    if (!user) {
      // The user was deleted but its identity row survived; treat this as a brand-new sign-in.
      await AuthIdentity.deleteOne({ _id: identity._id });
    } else {
      assertActive(user);
      identity.email = profile.email || identity.email;
      identity.emailVerified = profile.emailVerified;
      identity.name = profile.name;
      identity.avatarUrl = profile.avatarUrl;
      identity.lastLoginAt = new Date();
      await identity.save();
      return { user, outcome: 'login', passwordCleared: false };
    }
  }

  // Linking or creating by email is only safe when the provider vouches for that email. Otherwise
  // anyone could add "victim@company.com" as an unverified address on some provider and walk into
  // the victim's account here.
  if (!profile.email || !profile.emailVerified) {
    throw oauthError(403, 'email_unverified', 'Provider profile has no verified email address.');
  }

  const existing = await User.findOne({ email: profile.email }).select('+password');
  if (existing) {
    assertActive(existing);
    let passwordCleared = false;
    if (existing.password && !existing.emailVerified) {
      // Pre-account-hijacking defence. Registration never verifies email, so this password could
      // have been set by an attacker who registered the victim's address first, waiting for the
      // real owner to arrive via Google/GitHub. The owner has now proven the email, so the
      // unproven password and every session issued with it are revoked. A legitimate owner who
      // wants their password back uses forgot-password, which itself proves the inbox.
      existing.password = undefined;
      existing.sessionVersion = (existing.sessionVersion ?? 0) + 1;
      passwordCleared = true;
    }
    existing.emailVerified = true;
    await existing.save();
    await createIdentity(existing._id, providerId, profile);
    return { user: existing, outcome: 'linked', passwordCleared };
  }

  const name = profile.name?.trim().length >= 2 ? profile.name.trim() : profile.email.split('@')[0];
  const user = await User.create({
    name,
    email: profile.email,
    role: roles.OWNER,
    emailVerified: true,
    legalConsent: {
      // The login page states that continuing with a provider accepts these, in place of the
      // register form's checkbox.
      termsVersionAccepted: currentLegalVersions.terms,
      privacyVersionAccepted: currentLegalVersions.privacy,
      acceptedAt: new Date(),
      acceptedIp: ip,
    },
  });
  try {
    await createIdentity(user._id, providerId, profile);
  } catch (error) {
    await User.deleteOne({ _id: user._id }); // lost a race — don't leave a half-created account
    throw error;
  }
  const workspace = await Workspace.create({ name: `${name}'s workspace`, owner: user._id });
  user.workspace = workspace._id;
  await user.save();
  return { user, outcome: 'registered', passwordCleared: false };
}

function createIdentity(userId, providerId, profile) {
  return AuthIdentity.create({
    userId,
    provider: providerId,
    subject: profile.subject,
    email: profile.email,
    emailVerified: profile.emailVerified,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    lastLoginAt: new Date(),
  });
}

function assertActive(user) {
  if (user.status !== 'active') throw oauthError(403, 'account_inactive', 'This account is not active.');
}

// --- Single-use login ticket ----------------------------------------------------------------------
// The callback runs on the API's domain inside a browser redirect; the SPA lives on another origin
// and keeps its session in localStorage, so the session has to be handed across. Tokens never go in
// a URL. Instead the callback mints a random ticket (only its SHA-256 is stored, in its own
// collection with a TTL index), valid for 60 s and redeemable once, and the SPA swaps it for tokens
// with a POST. The ticket is also bound to the browser that started the sign-in: redeeming it needs
// the verifier whose challenge that browser sent to /start, so a ticket leaked from a URL — or
// planted by an attacker — is useless anywhere else.

export function hashTicket(ticket) {
  return crypto.createHash('sha256').update(String(ticket)).digest('hex');
}

export async function issueLoginTicket(user, clientChallenge, { notice = null } = {}) {
  const ticket = randomToken(32);
  await OAuthLoginTicket.create({
    ticketHash: hashTicket(ticket),
    clientChallenge,
    userId: user._id,
    notice,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return ticket;
}

export async function redeemLoginTicket({ ticket, verifier }) {
  // One atomic find-and-delete: of two concurrent redemptions, only one can match.
  const row = await OAuthLoginTicket.findOneAndDelete({
    ticketHash: hashTicket(ticket),
    clientChallenge: pkceChallenge(String(verifier)),
    expiresAt: { $gt: new Date() },
  });
  if (!row) throw oauthError(400, 'ticket_invalid', 'This sign-in link is invalid or has expired. Please sign in again.');
  const user = await User.findById(row.userId);
  if (!user) throw oauthError(400, 'ticket_invalid', 'This sign-in link is invalid or has expired. Please sign in again.');
  assertActive(user);
  return { user, notice: row.notice ?? null };
}
