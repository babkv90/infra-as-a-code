import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Files land here under a server-generated UUID name (never the user's original filename) and stay
// until a deployment references them — terraformDeploymentRunner.js copies the referenced ones into
// a deployment's Terraform work directory before `apply` runs. See terraformGenerator.js's
// `case 'lambda':` for how the uploadId becomes the `filename` argument on aws_lambda_function.
export const LAMBDA_ZIP_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/lambda-zips');
try {
  mkdirSync(LAMBDA_ZIP_UPLOAD_ROOT, { recursive: true });
} catch {
  // Read-only filesystem (e.g. this module loaded inside an AWS Lambda deployment package) —
  // zip uploads won't work in that environment, but the whole process shouldn't crash on cold
  // start just because this one directory couldn't be created.
}

// Matches the AWS Lambda console's own direct-upload limit; larger packages need to go through S3,
// which this simple local-disk flow doesn't support.
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, LAMBDA_ZIP_UPLOAD_ROOT);
  },
  filename(_req, _file, callback) {
    callback(null, `${crypto.randomUUID()}.zip`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    const isZip = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.toLowerCase().endsWith('.zip');
    if (!isZip) {
      callback(new Error('Only .zip files are accepted for a Lambda deployment package.'));
      return;
    }
    callback(null, true);
  },
});

export function lambdaZipUpload(fieldName) {
  const middleware = uploader.single(fieldName);
  return function handleLambdaZipUpload(req, res, next) {
    middleware(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError || /Only \.zip files/.test(error.message)) {
        return next(new ApiError(400, error.message));
      }
      next(error);
    });
  };
}
