import { z } from 'zod';
import { env } from '../config/env.js';
import { Workspace } from '../models/Workspace.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { sendAuthTokens } from '../utils/tokens.js';
import { ensureWorkspaceOwnerRole } from '../utils/workspaceOwnerRole.js';
import { getOAuthProvider, listConfiguredOAuthProviders, oauthError } from '../services/oauthProviders.js';
import {
  allowedAppOrigin,
  createOAuthTransaction,
  isPkceChallenge,
  issueLoginTicket,
  oauthTxCookieName,
  oauthTxCookieOptions,
  readOAuthTransaction,
  redeemLoginTicket,
  resolveOAuthUser,
  safeReturnTo,
} from '../services/oauthLogin.js';
import { serializeUser } from './authController.js';

// Sign in with Google / GitHub — OAuth 2.0 Authorization Code flow with PKCE (OpenID Connect for
// Google). Four legs, all under /api/v1/auth/oauth:
//   GET  /providers            which buttons the login page should show
//   GET  /:provider/start      browser navigates here → 302 to the provider's consent screen
//   GET  /:provider/callback   provider redirects back with ?code&state → 302 to the SPA with a ticket
//   POST /exchange             SPA swaps that ticket (+ its verifier) for the normal session tokens
// After /exchange the user holds exactly the same access/refresh tokens a password login produces,
// so nothing downstream (requireAuth, authorize, the SPA's apiClient) knows or cares how they signed in.

export const oauthExchangeSchema = z.object({
  body: z.object({
    ticket: z.string().min(32).max(128),
    verifier: z.string().min(43).max(128),
  }),
});

export const listOAuthProviders = (_req, res) => {
  res.json({ success: true, data: { providers: listConfiguredOAuthProviders() } });
};

// Also a browser navigation, so a refusal goes back to the login page as a code rather than JSON.
export const startOAuthLogin = (req, res) => {
  const appOrigin = allowedAppOrigin(req.query.origin);
  let provider;
  try {
    provider = getOAuthProvider(String(req.params.provider));
    if (!isPkceChallenge(req.query.client_challenge)) {
      throw oauthError(400, 'failed', 'Missing or malformed client_challenge — sign-in not started from the login page.');
    }
  } catch (startError) {
    const code = startError.details?.oauthCode ?? 'failed';
    logSignInFailure(req, String(req.params.provider), code, startError);
    return res.redirect(frontendLoginUrl(appOrigin, { errorCode: code }));
  }

  const tx = createOAuthTransaction({
    providerId: provider.id,
    returnTo: safeReturnTo(req.query.next),
    clientChallenge: req.query.client_challenge,
    appOrigin,
  });
  res.cookie(oauthTxCookieName(provider.id), tx.cookieValue, oauthTxCookieOptions());
  res.redirect(
    provider.authorizeUrl({
      redirectUri: oauthCallbackUrl(req, provider.id),
      state: tx.state,
      nonce: tx.nonce,
      codeChallenge: tx.codeChallenge,
    }),
  );
};

// A browser navigation, not an XHR: every outcome — including failures — ends in a redirect back to
// the login page, never a JSON error body the user would be left staring at.
export const oauthLoginCallback = async (req, res) => {
  const providerId = String(req.params.provider);
  const cookieName = oauthTxCookieName(providerId);
  const cookieValue = req.cookies?.[cookieName];
  // Single use: whatever happens next, this attempt's state/verifier must not be usable again.
  const { maxAge: _maxAge, ...clearOptions } = oauthTxCookieOptions();
  res.clearCookie(cookieName, clearOptions);
  let appOrigin = allowedAppOrigin();

  try {
    const provider = getOAuthProvider(providerId);
    const { code, state, error, error_description: errorDescription } = req.query;
    const tx = readOAuthTransaction({ cookieValue, providerId: provider.id, state: String(state ?? '') });
    appOrigin = tx.appOrigin || appOrigin;

    if (error === 'access_denied') throw oauthError(400, 'cancelled', 'User cancelled at the provider.');
    if (error) throw oauthError(400, 'provider_error', `Provider returned error=${error}: ${errorDescription ?? ''}`);
    if (!code || typeof code !== 'string') throw oauthError(400, 'provider_error', 'Provider returned no authorization code.');

    const profile = await provider.fetchProfile({
      code,
      redirectUri: oauthCallbackUrl(req, provider.id),
      codeVerifier: tx.codeVerifier,
      nonce: tx.nonce,
    });
    const { user, outcome, passwordCleared } = await resolveOAuthUser({ providerId: provider.id, profile, ip: req.ip });

    user.lastLoginAt = new Date();
    await ensureWorkspaceOwnerRole(user);
    await user.save();
    await auditLog({ user, ip: req.ip }, `auth.oauth.${outcome}`, 'User', user._id, { provider: provider.id, passwordCleared });

    const ticket = await issueLoginTicket(user, tx.clientChallenge, { notice: passwordCleared ? 'password_removed' : null });
    return res.redirect(frontendLoginUrl(appOrigin, { ticket, next: tx.returnTo }));
  } catch (callbackError) {
    const code = callbackError instanceof ApiError ? (callbackError.details?.oauthCode ?? 'failed') : 'failed';
    logSignInFailure(req, providerId, code, callbackError);
    return res.redirect(frontendLoginUrl(appOrigin, { errorCode: code }));
  }
};

export const exchangeOAuthLoginTicket = asyncHandler(async (req, res) => {
  const { ticket, verifier } = req.validated.body;
  const { user, notice } = await redeemLoginTicket({ ticket, verifier });

  const tokens = sendAuthTokens(res, user);
  const workspace = await Workspace.findById(user.workspace);
  res.json({
    success: true,
    data: {
      user: serializeUser(user, workspace),
      accessToken: tokens.accessToken,
      notice,
    },
  });
});

// Every failed sign-in leaves one structured line — the only place a rejected state, an unverified
// email, or a provider outage becomes visible, since none of them reach the audit log (there may be
// no user yet). Never logs the code, state, tokens, or cookie. A user pressing Cancel is routine
// (info); anything we refused is worth watching (warn); our own or a provider's failure is an error.
function logSignInFailure(req, providerId, code, error) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const line = { provider: providerId, code, statusCode, reason: error?.message, ip: req.ip };
  if (code === 'cancelled') console.info('[oauth] sign-in cancelled', line);
  else if (statusCode < 500) console.warn('[oauth] sign-in rejected', line);
  else console.error('[oauth] sign-in failed', line);
}

function oauthCallbackUrl(req, providerId) {
  const base = env.OAUTH_CALLBACK_BASE_URL || `${req.protocol}://${req.get('host')}/api/v1`;
  return `${base}/auth/oauth/${providerId}/callback`;
}

// `appOrigin` has already been through allowedAppOrigin()'s exact-match allowlist — the ticket is a
// credential, and a redirect target an attacker could choose would hand it to them.
function frontendLoginUrl(appOrigin, { ticket, next, errorCode }) {
  const url = new URL('/login', appOrigin);
  if (errorCode) {
    // A code only — the login page owns the wording (see oauthError() in services/oauthProviders.js).
    url.searchParams.set('oauth_error', errorCode);
    return url.toString();
  }
  // The fragment (#...) is never sent to any server — not in requests, Referer headers, or CDN logs.
  url.hash = new URLSearchParams({ oauth_ticket: ticket, next: safeReturnTo(next) }).toString();
  return url.toString();
}
