import { env } from '../config/env.js';

const allowedCorsOrigins = new Set([
  ...env.CLIENT_ORIGINS.map(normalizeOrigin),
  'https://v72gcv51pi.execute-api.ap-south-1.amazonaws.com',
  'https://d3pgg5abvvdatt.cloudfront.net',
  'https://codemanus.in',
  'https://www.codemanus.in',
]);

export function isAllowedCorsOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!origin) return true;
  if (allowedCorsOrigins.has(normalizedOrigin)) return true;
  return /^https:\/\/[a-z0-9-]+\.cloudfront\.net$/i.test(normalizedOrigin)
    || /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(normalizedOrigin);
}

export function corsHeaders(origin) {
  const allowedOrigin = isAllowedCorsOrigin(origin) ? normalizeOrigin(origin) : undefined;

  return {
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    Vary: 'Origin',
  };
}

function normalizeOrigin(origin = '') {
  return String(origin).trim().replace(/\/+$/, '');
}
