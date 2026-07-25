import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import { LocalStorageAdapter } from './LocalStorageAdapter.js';
import { S3StorageAdapter } from './S3StorageAdapter.js';

// STORAGE_MODE is read exactly once, here, at module load. Every other file imports `storage` and
// calls its adapter methods — nothing else in the codebase should branch on env.STORAGE_MODE.
function createStorageAdapter() {
  if (env.STORAGE_MODE === 's3') {
    return new S3StorageAdapter({ bucket: env.STORAGE_S3_BUCKET, region: env.STORAGE_S3_REGION });
  }

  return new LocalStorageAdapter({ rootDir: env.TERRAFORM_WORK_DIR || path.join(tmpdir(), 'infraflow-deployments') });
}

export const storage = createStorageAdapter();
