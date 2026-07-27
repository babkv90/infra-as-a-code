import { env } from '../config/env.js';

const allowedCorsOrigins = new Set([
  ...env.CLIENT_ORIGINS,
  'https://cjgutvxvh2.execute-api.ap-south-1.amazonaws.com',
  'https://d3pgg5abvvdatt.cloudfront.net',
]);

export function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (allowedCorsOrigins.has(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.cloudfront\.net$/i.test(origin);
}

export function corsHeaders(origin) {
  const allowedOrigin = isAllowedCorsOrigin(origin) ? origin : undefined;

  return {
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    Vary: 'Origin',
  };
}
