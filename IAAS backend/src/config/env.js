import dotenv from 'dotenv';

dotenv.config();

function readNumber(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(name, fallback) {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: readNumber('PORT', 4000),
  MONGODB_URI: process.env.MONGODB_URI ?? '',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  CLIENT_ORIGINS: readList('CLIENT_ORIGIN', 'http://127.0.0.1:5173,http://localhost:5173'),
  BCRYPT_ROUNDS: readNumber('BCRYPT_ROUNDS', 12),
  RATE_LIMIT_WINDOW_MS: readNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber('RATE_LIMIT_MAX', 300),
  TERRAFORM_APPLY_ENABLED: process.env.TERRAFORM_APPLY_ENABLED === 'true',
  TERRAFORM_BIN: process.env.TERRAFORM_BIN ?? 'terraform',
  TERRAFORM_WORK_DIR: process.env.TERRAFORM_WORK_DIR ?? '',
};

if (!env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Add it to IAAS backend/.env before running the API.');
}
