import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      workspace: user.workspace?.toString(),
      sv: user.sessionVersion ?? 0,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString(), type: 'refresh', sv: user.sessionVersion ?? 0 }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  });
}

// Both verifiers turn jsonwebtoken's own errors (expired, bad signature, malformed) into a 401 —
// left as-is they reach errorHandler as a plain Error and come back as a 500.
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid or expired access token');
  }
}

export function verifyRefreshToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }
  if (payload.type !== 'refresh') throw new ApiError(401, 'Invalid refresh token');
  return payload;
}

// A token stays cryptographically valid until it expires; this is what makes it revocable early.
// Tokens minted before `sv` existed carry none and count as version 0, same as every existing user.
export function assertSessionCurrent(payload, user) {
  if ((payload.sv ?? 0) !== (user.sessionVersion ?? 0)) {
    throw new ApiError(401, 'Session has been revoked. Please sign in again.');
  }
}

// The refresh cookie is the only thing that survives a reload — the SPA keeps the access token in
// memory and calls POST /auth/refresh to get a new one. Deployed, the SPA (CloudFront) and the API
// (execute-api) are different sites, so the cookie must be SameSite=None (which requires Secure) or
// the browser never sends it on that fetch; utils/cors.js is what stops other sites from using it.
// Locally both run on 127.0.0.1, where Lax works over plain http.
function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.IS_DEPLOYED ? 'none' : 'lax',
    secure: env.IS_DEPLOYED,
  };
}

// Must carry the same SameSite/Secure as when it was set: a cross-site response can't overwrite a
// SameSite=None cookie with a Lax one, so a bare clearCookie would silently leave it in place.
export function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', refreshCookieOptions());
}

export function sendAuthTokens(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  res.cookie('refreshToken', refreshToken, {
    ...refreshCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return { accessToken, refreshToken };
}
