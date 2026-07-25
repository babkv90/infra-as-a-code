import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

// Matches the AWS Lambda console's own direct-upload limit; larger packages need to go through S3,
// which this simple flow doesn't support.
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Buffered in memory rather than written straight to local disk (the old behavior) so the same
// upload handler works unchanged in both storage modes — see deploymentController.js's
// uploadLambdaZip, which hands req.file.buffer to the StorageAdapter-backed saveLambdaZipUpload().
const uploader = multer({
  storage: multer.memoryStorage(),
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
