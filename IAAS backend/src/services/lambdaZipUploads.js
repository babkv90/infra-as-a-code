import crypto from 'node:crypto';
import { storage } from '../storage/index.js';

// Every uploaded Lambda zip gets a small JSON sidecar next to it in the same storage adapter, under
// the same key prefix — this is "the record that tracks the upload" that terraformGenerator.js reads
// for source_code_hash in S3 mode, and that terraformDeploymentRunner.js could use in local mode too
// (though local mode currently recomputes the hash itself via Terraform's own filebase64sha256).
function zipKey(uploadId) {
  return `lambda-zips/${uploadId}.zip`;
}

function metadataKey(uploadId) {
  return `lambda-zips/${uploadId}.json`;
}

export async function saveLambdaZipUpload(buffer, originalFileName) {
  const uploadId = crypto.randomUUID();
  // Matches Terraform's own filebase64sha256(): base64(sha256(raw file bytes)). AWS Lambda's "Code
  // SHA256" is computed the same way, so this value is valid for source_code_hash regardless of
  // which storage mode ends up serving the zip.
  const sourceCodeHash = crypto.createHash('sha256').update(buffer).digest('base64');
  const uploadedAt = new Date().toISOString();

  await storage.writeFile(zipKey(uploadId), buffer);
  await storage.writeFile(
    metadataKey(uploadId),
    JSON.stringify({ uploadId, originalFileName, sizeBytes: buffer.length, sourceCodeHash, uploadedAt }),
  );

  return { uploadId, fileName: originalFileName, sizeBytes: buffer.length, sourceCodeHash };
}

export async function getLambdaZipUploadMetadata(uploadId) {
  if (!(await storage.exists(metadataKey(uploadId)))) return null;
  const raw = await storage.readFile(metadataKey(uploadId));
  return JSON.parse(raw.toString('utf8'));
}

export function lambdaZipStorageKey(uploadId) {
  return zipKey(uploadId);
}

// Enumerates by the .zip files themselves, not their .json sidecars — uploads made before the
// sidecar existed (or any that lost theirs) are still real disk usage and still need to be found by
// lambdaZipCleanup.js, even though getLambdaZipUploadMetadata will return null for them.
export async function listLambdaZipUploadIds() {
  const names = await storage.listFiles('lambda-zips');
  return names.filter((name) => name.endsWith('.zip')).map((name) => name.slice(0, -'.zip'.length));
}

export async function deleteLambdaZipUpload(uploadId) {
  await storage.deleteFile(zipKey(uploadId));
  await storage.deleteFile(metadataKey(uploadId));
}
