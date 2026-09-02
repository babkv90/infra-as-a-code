import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

// Memory storage: the buffer is forwarded straight to the agent service (base64 in a Lambda
// payload, or multipart to the local HTTP service) and never written to this server's disk.
// 6 MB matches the agent's rag_max_document_bytes and the synchronous Lambda invoke payload ceiling.
const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/json',
  'application/x-yaml',
  'text/yaml',
  '',
]);

const NAME_FALLBACK = /\.(pdf|md|markdown|txt|text|rst|csv|json|ya?ml)$/i;

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    const ok = ALLOWED_MIME_TYPES.has(file.mimetype) || NAME_FALLBACK.test(file.originalname);
    if (!ok) {
      callback(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}. Upload a PDF or a text/markdown file.`));
      return;
    }
    callback(null, true);
  },
});

export function knowledgeDocumentUpload(fieldName = 'file') {
  const middleware = uploader.single(fieldName);
  return function handleKnowledgeUpload(req, res, next) {
    middleware(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError || /Unsupported file type/.test(error.message)) {
        return next(new ApiError(400, error.message));
      }
      next(error);
    });
  };
}
