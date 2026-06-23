import dotenv from 'dotenv';

dotenv.config();

function readString(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;

  const trimmed = value.trim();
  const hasMatchingQuotes =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));

  return hasMatchingQuotes ? trimmed.slice(1, -1) : trimmed;
}

function readNumber(name, fallback) {
  const value = readString(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(name, fallback) {
  return readString(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = {
  NODE_ENV: readString('NODE_ENV', 'development'),
  PORT: readNumber('PORT', 4000),
  MONGODB_URI: readString('MONGODB_URI'),
  JWT_ACCESS_SECRET: readString('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: readString('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  JWT_ACCESS_EXPIRES_IN: readString('JWT_ACCESS_EXPIRES_IN', '15m'),
  JWT_REFRESH_EXPIRES_IN: readString('JWT_REFRESH_EXPIRES_IN', '7d'),
  CLIENT_ORIGINS: readList('CLIENT_ORIGIN', 'http://127.0.0.1:5173,http://localhost:5173'),
  BCRYPT_ROUNDS: readNumber('BCRYPT_ROUNDS', 12),
  RATE_LIMIT_WINDOW_MS: readNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  RATE_LIMIT_MAX: readNumber('RATE_LIMIT_MAX', 300),
  TERRAFORM_APPLY_ENABLED: readString('TERRAFORM_APPLY_ENABLED') === 'true',
  TERRAFORM_BIN: readString('TERRAFORM_BIN', 'terraform'),
  TERRAFORM_WORK_DIR: readString('TERRAFORM_WORK_DIR'),
};

if (!env.MONGODB_URI) {
  console.warn('MONGODB_URI is not set. Add it to IAAS backend/.env before running the API.');
}
