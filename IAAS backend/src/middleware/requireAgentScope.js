import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

// Verifies the machine JWT minted by agentIdentity.js's mintAgentToken() — a *different* identity
// from requireAuth.js's user session token. Every /internal/agent-tools/* route sits behind this
// instead of requireAuth, so the agent service never needs (or gets) a user's own bearer token.
export function requireAgentScope(...requiredScopes) {
  return function requireAgentScopeMiddleware(req, _res, next) {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      return next(new ApiError(401, 'Agent authentication required'));
    }

    let payload;
    try {
      payload = jwt.verify(token, env.AGENT_TOOL_SECRET, { audience: 'agent-tools' });
    } catch {
      return next(new ApiError(401, 'Invalid or expired agent token'));
    }

    const grantedScopes = Array.isArray(payload.scope) ? payload.scope : [];
    const missing = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length) {
      return next(new ApiError(403, `Agent token missing required scope(s): ${missing.join(', ')}`));
    }

    req.agent = {
      workspaceId: payload.workspace,
      runId: payload.run,
      actingUserId: payload.act,
      scopes: grantedScopes,
    };
    next();
  };
}
