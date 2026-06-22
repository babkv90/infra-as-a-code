import { hasRoleAtLeast } from '../constants/roles.js';
import { ApiError } from '../utils/ApiError.js';

export function authorize(requiredRole) {
  return function authorizeRole(req, _res, next) {
    if (!req.user || !hasRoleAtLeast(req.user.role, requiredRole)) {
      return next(new ApiError(403, 'You do not have permission to perform this action'));
    }
    next();
  };
}
