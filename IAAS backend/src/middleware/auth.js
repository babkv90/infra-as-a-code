import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) {
    throw new ApiError(401, 'Authentication required');
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);

  if (!user || user.status !== 'active') {
    throw new ApiError(401, 'Invalid or disabled user');
  }

  req.user = user;
  next();
});
