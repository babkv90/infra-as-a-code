import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { StorageAdapter } from './StorageAdapter.js';

// Keys are relative paths under `rootDir` (e.g. "lambda-zips/<uploadId>.zip"). No AWS calls at all.
export class LocalStorageAdapter extends StorageAdapter {
  constructor({ rootDir }) {
    super();
    this.rootDir = rootDir;
  }

  async writeFile(key, content) {
    const target = this._resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  async readFile(key) {
    return readFile(this._resolve(key));
  }

  async deleteFile(key) {
    await rm(this._resolve(key), { force: true });
  }

  async exists(key) {
    try {
      await access(this._resolve(key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getWorkingDirectory(deploymentId) {
    const dir = path.join(this.rootDir, 'runs', deploymentId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  resolveArtifactReference(key) {
    return { type: 'local', filename: path.basename(key) };
  }

  _resolve(key) {
    return path.join(this.rootDir, key);
  }
}
