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

function getDatabaseFailureHint(error) {
  const message = error instanceof Error ? error.message : '';

  if (!env.MONGODB_URI) {
    return 'MONGODB_URI is not configured in Vercel environment variables.';
  }

  if (message.includes('bad auth') || message.includes('Authentication failed')) {
    return 'MongoDB authentication failed. Check the username and password in Vercel MONGODB_URI.';
  }

  if (message.includes('IP') || message.includes('not authorized')) {
    return 'MongoDB Atlas rejected the Vercel IP address. Update Atlas Network Access for Vercel.';
  }

  if (message.includes('ENOTFOUND') || message.includes('querySrv')) {
    return 'MongoDB hostname could not be resolved. Check the cluster hostname in Vercel MONGODB_URI.';
  }

  if (message.includes('timed out') || message.includes('Server selection timed out')) {
    return 'MongoDB connection timed out. Check Atlas Network Access and whether the cluster is paused.';
  }

  return 'Database connection failed. Check MongoDB Atlas network access and Vercel environment variables.';
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
      message: getDatabaseFailureHint(error),
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}
