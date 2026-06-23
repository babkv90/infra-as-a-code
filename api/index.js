import { app } from '../IAAS backend/src/app.js';
import { connectDatabase } from '../IAAS backend/src/config/database.js';

let databaseReady;

function isHealthCheck(url = '') {
  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname === '/health' || pathname === '/api/v1/health';
}

async function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = connectDatabase();
  }

  await databaseReady;
}

export default async function handler(req, res) {
  if (!isHealthCheck(req.url)) {
    await ensureDatabase();
  }

  return app(req, res);
}
