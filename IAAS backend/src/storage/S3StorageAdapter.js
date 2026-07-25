import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageAdapter } from './StorageAdapter.js';

// Keys are S3 object keys, used as-is (callers are expected to prefix with a deployment id where
// that's meaningful, e.g. "deployments/<id>/main.tf"). getWorkingDirectory() still returns a real
// local path — the Terraform CLI has to run somewhere — but it's meant to be treated as ephemeral
// scratch space in this mode and cleaned up by the caller once a run finishes (see
// terraformDeploymentRunner.js's cleanup step, not part of this adapter).
export class S3StorageAdapter extends StorageAdapter {
  constructor({ bucket, region, scratchRoot }) {
    super();
    if (!bucket) throw new Error('S3StorageAdapter requires a bucket.');
    this.bucket = bucket;
    this.client = new S3Client(region ? { region } : {});
    this.scratchRoot = scratchRoot ?? path.join(tmpdir(), 'infraflow-deployments');
  }

  async writeFile(key, content) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content }));
  }

  async readFile(key) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async deleteFile(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  async getWorkingDirectory(deploymentId) {
    const dir = path.join(this.scratchRoot, deploymentId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  resolveArtifactReference(key) {
    return { type: 's3', bucket: this.bucket, key };
  }
}
