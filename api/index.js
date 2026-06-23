import { app } from '../IAAS backend/src/app.js';
import { connectDatabase } from '../IAAS backend/src/config/database.js';
import { env } from '../IAAS backend/src/config/env.js';

let databaseReady;

function getPathname(url = '') {
  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname;
}

function isHealthCheck(url = '') {
  const pathname = getPathname(url);
  return pathname === '/health' || pathname === '/api/v1/health';
}

function isReadinessCheck(url = '') {
  const pathname = getPathname(url);
  return pathname === '/ready' || pathname === '/api/v1/ready';
}

async function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = connectDatabase();
  }

  await databaseReady;
}

export default async function handler(req, res) {
  try {
    if (isReadinessCheck(req.url)) {
      await ensureDatabase();
      return res.status(200).json({
        ok: true,
        service: 'iaas-backend',
        database: 'connected',
        hasMongoUri: Boolean(env.MONGODB_URI),
      });
    }

    if (!isHealthCheck(req.url)) {
      await ensureDatabase();
    }

    return app(req, res);
  } catch (error) {
    console.error('API startup failure', error);

    return res.status(503).json({
      success: false,
      message: env.MONGODB_URI
        ? 'Database connection failed. Check MongoDB Atlas network access and Vercel environment variables.'
        : 'MONGODB_URI is not configured in Vercel environment variables.',
    });
  }
}
