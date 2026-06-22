import { ApiError } from '../utils/ApiError.js';

export function errorHandler(error, _req, res, _next) {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    success: false,
    message: error.message ?? 'Internal server error',
    details: error.details,
  });
}
