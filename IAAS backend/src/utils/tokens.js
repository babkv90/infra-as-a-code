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

export function sendAuthTokens(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return { accessToken, refreshToken };
}
