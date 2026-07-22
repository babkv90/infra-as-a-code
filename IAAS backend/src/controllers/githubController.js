import { env } from '../config/env.js';
import { GitHubConnection } from '../models/GitHubConnection.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../utils/audit.js';
import { verifyAccessToken, verifyRefreshToken } from '../utils/tokens.js';
import {
  assertGithubOAuthConfigured,
  createGithubOAuthState,
  decryptGithubAccessToken,
  encryptGithubAccessToken,
  exchangeGithubCodeForToken,
  fetchGithubUserProfile,
  githubAuthorizeRedirectUrl,
  githubJson,
  verifyGithubOAuthState,
} from '../services/githubOAuthService.js';

export const startGithubOAuth = asyncHandler(async (req, res) => {
  assertGithubOAuthConfigured();

  const user = await userFromOAuthRequest(req);
  const mode = req.query.mode === 'popup' ? 'popup' : 'redirect';
  const returnTo = safeReturnTo(req.query.returnTo);
  const state = createGithubOAuthState({ userId: user._id, mode, returnTo });

  res.redirect(githubAuthorizeRedirectUrl({ redirectUri: githubCallbackUrl(req), state }));
});

export const githubOAuthCallback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description: description } = req.query;
  let statePayload;

  try {
    statePayload = verifyGithubOAuthState(state);
  } catch (stateError) {
    return finishGithubOAuth(req, res, { success: false, message: stateError.message, returnTo: '/settings' });
  }

  if (error) {
    return finishGithubOAuth(req, res, {
      success: false,
      message: description || error,
      mode: statePayload.mode,
      returnTo: statePayload.returnTo,
    });
  }

  if (!code || typeof code !== 'string') {
    return finishGithubOAuth(req, res, {
      success: false,
      message: 'GitHub did not return an authorization code.',
      mode: statePayload.mode,
      returnTo: statePayload.returnTo,
    });
  }

  try {
    const token = await exchangeGithubCodeForToken({ code, redirectUri: githubCallbackUrl(req) });
    const { profile, scopes } = await fetchGithubUserProfile(token.accessToken);
    const user = await User.findById(statePayload.sub);
    if (!user || user.status !== 'active') throw new ApiError(401, 'User not found or disabled.');

    await GitHubConnection.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        githubId: String(profile.id),
        githubUsername: profile.login ?? '',
        githubName: profile.name ?? '',
        avatarUrl: profile.avatar_url ?? '',
        scopes: scopes.length ? scopes : token.scopes,
        accessTokenEncrypted: encryptGithubAccessToken(token.accessToken),
        connectedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Keep a non-secret summary on the user record for older UI paths that still read req.user.
    user.githubConnection = {
      login: profile.login ?? '',
      name: profile.name ?? '',
      avatarUrl: profile.avatar_url ?? '',
      scopes: scopes.length ? scopes : token.scopes,
      connectedAt: new Date(),
    };
    await user.save();
    await auditLog({ user, ip: req.ip }, 'github.connect', 'GitHubConnection', user._id, { login: profile.login });

    return finishGithubOAuth(req, res, {
      success: true,
      message: 'GitHub connected.',
      mode: statePayload.mode,
      returnTo: statePayload.returnTo,
    });
  } catch (callbackError) {
    return finishGithubOAuth(req, res, {
      success: false,
      message: callbackError.message || 'GitHub connection failed.',
      mode: statePayload.mode,
      returnTo: statePayload.returnTo,
    });
  }
});

export const getGithubConnection = asyncHandler(async (req, res) => {
  const connection = await GitHubConnection.findOne({ userId: req.user._id });
  res.json({ success: true, data: serializeConnection(connection) });
});

export const disconnectGithub = asyncHandler(async (req, res) => {
  await GitHubConnection.deleteOne({ userId: req.user._id });
  req.user.githubConnection = undefined;
  await req.user.save();
  await auditLog(req, 'github.disconnect', 'GitHubConnection', req.user._id);
  res.json({ success: true, data: { connected: false } });
});

export const listGithubRepositories = asyncHandler(async (req, res) => {
  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before selecting a repository.');

  const repos = await githubJson('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', token);
  res.json({
    success: true,
    data: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner?.login,
      private: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
      updatedAt: repo.updated_at,
      permissions: {
        admin: Boolean(repo.permissions?.admin),
        maintain: Boolean(repo.permissions?.maintain),
        push: Boolean(repo.permissions?.push),
        triage: Boolean(repo.permissions?.triage),
        pull: Boolean(repo.permissions?.pull),
      },
    })),
  });
});

export const listGithubBranches = asyncHandler(async (req, res) => {
  const owner = String(req.query.owner ?? '').trim();
  const repo = String(req.query.repo ?? '').trim();
  if (!owner || !repo) throw new ApiError(400, 'GitHub owner and repository are required to load branches.');

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before selecting a branch.');

  const branches = await githubJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
    token,
  );
  res.json({
    success: true,
    data: branches.map((branch) => ({
      name: branch.name,
      protected: Boolean(branch.protected),
      commitSha: branch.commit?.sha ?? '',
    })),
  });
});

export async function githubTokenForUser(userId) {
  const connection = await GitHubConnection.findOne({ userId }).select('+accessTokenEncrypted');
  if (!connection?.accessTokenEncrypted) return '';
  connection.lastUsedAt = new Date();
  await connection.save();
  return decryptGithubAccessToken(connection.accessTokenEncrypted);
}

async function userFromOAuthRequest(req) {
  const token = bearerToken(req) || req.query.token;
  const payload = token ? verifyAccessToken(String(token)) : verifyRefreshTokenFromCookie(req);
  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') throw new ApiError(401, 'Invalid or disabled user.');
  return user;
}

function bearerToken(req) {
  const authHeader = req.headers.authorization ?? '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function verifyRefreshTokenFromCookie(req) {
  const token = req.cookies?.refreshToken;
  if (!token) throw new ApiError(401, 'Authentication required before connecting GitHub.');
  return verifyRefreshToken(token);
}

function githubCallbackUrl(req) {
  return env.GITHUB_OAUTH_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/v1/github/oauth/callback`;
}

function safeReturnTo(value) {
  const returnTo = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/settings';
  return returnTo.slice(0, 240);
}

function serializeConnection(connection) {
  if (!connection) {
    return { connected: false, login: '', username: '', avatarUrl: '', scopes: [] };
  }

  return connection.toSafeProfile();
}

function finishGithubOAuth(req, res, { success, message, mode = 'redirect', returnTo = '/settings' }) {
  if (mode === 'popup') {
    return res.type('html').send(popupHtml(success, message, returnTo));
  }

  const redirectUrl = frontendRedirectUrl(returnTo, success, message);
  return res.redirect(redirectUrl);
}

function frontendRedirectUrl(returnTo, success, message) {
  const origin = env.CLIENT_ORIGINS[0] ?? 'http://localhost:5173';
  const url = new URL(safeReturnTo(returnTo), origin);
  url.searchParams.set('github', success ? 'connected' : 'error');
  if (message) url.searchParams.set('github_message', String(message).slice(0, 160));
  return url.toString();
}

function popupHtml(success, message, returnTo = '/settings') {
  const payload = JSON.stringify({ type: 'infraflow:github-connected', success, message });
  const origins = JSON.stringify(env.CLIENT_ORIGINS.length ? env.CLIENT_ORIGINS : ['*']);
  const fallbackUrl = JSON.stringify(frontendRedirectUrl(returnTo, success, message));
  return `<!doctype html>
<html>
  <head>
    <title>GitHub connection</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <script>
      const payload = ${payload};
      const origins = ${origins};
      if (window.opener) {
        for (const origin of origins) {
          window.opener.postMessage(payload, origin);
        }
        window.opener.postMessage(payload, '*');
        setTimeout(() => window.close(), 200);
      } else {
        window.location.replace(${fallbackUrl});
      }
    </script>
    <p>${success ? 'GitHub connected. You can close this window.' : `GitHub connection failed: ${escapeHtml(message)}`}</p>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
