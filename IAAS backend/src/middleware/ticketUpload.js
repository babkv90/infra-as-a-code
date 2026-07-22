import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TICKET_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads/tickets');
mkdirSync(TICKET_UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/zip',
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, TICKET_UPLOAD_ROOT);
  },
  filename(_req, file, callback) {
    const extension = path.extname(file.originalname).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, '');
    callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new Error(`Unsupported file type: ${file.mimetype}. Allowed: images, text/log files, JSON, PDF, ZIP.`));
      return;
    }
    callback(null, true);
  },
});

export function ticketAttachmentUpload(fieldName) {
  const middleware = uploader.array(fieldName, MAX_FILES_PER_REQUEST);
  return function handleTicketUpload(req, res, next) {
    middleware(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError || /Unsupported file type/.test(error.message)) {
        return next(new ApiError(400, error.message));
      }
      next(error);
    });
  };
}
