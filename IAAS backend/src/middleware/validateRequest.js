import { ApiError } from '../utils/ApiError.js';

export function validateRequest(schema) {
  return function validate(req, _res, next) {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      return next(new ApiError(400, 'Invalid request payload', result.error.flatten()));
    }

    req.validated = result.data;
    next();
  };
}
