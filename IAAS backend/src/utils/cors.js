import { env } from '../config/env.js';

// Exact origins only — every allowed origin gets Access-Control-Allow-Credentials, and the refresh
// cookie is SameSite=None when deployed (utils/tokens.js), so an allowed origin can call
// POST /auth/refresh as the visitor and read back their access token. A wildcard such as
// *.cloudfront.net or *.vercel.app would hand that to anyone who deploys a page there. Add preview
// or extra frontends to CLIENT_ORIGINS instead.
const allowedCorsOrigins = new Set(
  [
    ...env.CLIENT_ORIGINS,
    'https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com',
    'https://d3pgg5abvvdatt.cloudfront.net',
    'https://codemanus.in',
    'https://www.codemanus.in',
  ]
    .map(normalizeOrigin)
    .filter((origin) => !env.IS_DEPLOYED || isPublicHttpsOrigin(origin)),
);

export function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  return allowedCorsOrigins.has(normalizeOrigin(origin));
}

export function corsHeaders(origin) {
  const allowedOrigin = isAllowedCorsOrigin(origin) ? normalizeOrigin(origin) : undefined;

  return {
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With,Cache-Control,Pragma',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    Vary: 'Origin',
  };
}

function normalizeOrigin(origin = '') {
  return String(origin).trim().replace(/\/+$/, '');
}

// env.js always merges the http://localhost dev origins into CLIENT_ORIGINS; a deployed API must not
// let whatever happens to run on a visitor's localhost read their session.
function isPublicHttpsOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
