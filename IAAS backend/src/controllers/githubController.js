import { env } from '../config/env.js';
import {
  githubOAuthScope,
  githubReconnectRequiredDetails,
  hasRequiredGithubScopes,
  missingGithubScopes,
  normalizeGithubScopes,
  requiredGithubScopes,
} from '../constants/githubOAuth.js';
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
  fetchGithubTokenScopes,
  fetchGithubUserProfile,
  githubAuthorizeRedirectUrl,
  githubJson,
  verifyGithubOAuthState,
} from '../services/githubOAuthService.js';
import { encodeURIComponentPath } from '../services/githubActionsClient.js';

export const startGithubOAuth = asyncHandler(async (req, res) => {
  assertGithubOAuthConfigured();

  const user = await userFromOAuthRequest(req);
  const mode = req.query.mode === 'popup' ? 'popup' : 'redirect';
  const returnTo = safeReturnTo(req.query.returnTo);
  const state = createGithubOAuthState({ userId: user._id, mode, returnTo });
  const redirectUrl = githubAuthorizeRedirectUrl({ redirectUri: githubCallbackUrl(req), state });
  logGithubScopes('oauth.start', {
    requiredScopes: requiredGithubScopes,
    requestedScopes: new URL(redirectUrl).searchParams.get('scope') ?? '',
  });

  res.redirect(redirectUrl);
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
    await clearGithubConnectionSummary(statePayload.sub);
    return finishGithubOAuth(req, res, {
      success: false,
      message: githubDeniedMessage(description || error),
      mode: statePayload.mode,
      returnTo: statePayload.returnTo,
      details: githubReconnectRequiredDetails([]),
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
    const user = await User.findById(statePayload.sub);
    if (!user || user.status !== 'active') throw new ApiError(401, 'User not found or disabled.');

    const token = await exchangeGithubCodeForToken({ code, redirectUri: githubCallbackUrl(req) });
    await GitHubConnection.deleteOne({ userId: user._id });
    user.githubConnection = undefined;
    await user.save();

    const { profile, scopes: profileScopes } = await fetchGithubUserProfile(token.accessToken);
    let grantedScopes = normalizeGithubScopes([...token.scopes, ...profileScopes]);
    if (!grantedScopes.length) {
      grantedScopes = normalizeGithubScopes(await fetchGithubTokenScopes(token.accessToken));
    }
    const missingScopes = missingGithubScopes(grantedScopes);
    logGithubScopes('oauth.callback', { requiredScopes: requiredGithubScopes, grantedScopes, missingScopes });

    if (!hasRequiredGithubScopes(grantedScopes)) {
      user.githubConnection = {
        login: profile.login ?? '',
        name: profile.name ?? '',
        avatarUrl: profile.avatar_url ?? '',
        scopes: grantedScopes,
        connectedAt: undefined,
      };
      await user.save();
      await auditLog({ user, ip: req.ip }, 'github.connect.scope_missing', 'GitHubConnection', user._id, {
        login: profile.login,
        requiredScopes: requiredGithubScopes,
        grantedScopes,
        missingScopes,
      });
      return finishGithubOAuth(req, res, {
        success: false,
        message: reconnectRequiredMessage(missingScopes),
        mode: statePayload.mode,
        returnTo: statePayload.returnTo,
        details: githubReconnectRequiredDetails(grantedScopes),
      });
    }

    await GitHubConnection.findOneAndUpdate(
      { userId: user._id },
      {
        userId: user._id,
        githubId: String(profile.id),
        githubUsername: profile.login ?? '',
        githubName: profile.name ?? '',
        avatarUrl: profile.avatar_url ?? '',
        scopes: grantedScopes,
        missingScopes: [],
        reconnectRequired: false,
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
      scopes: grantedScopes,
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
  res.json({ success: true, data: serializeConnection(connection, req.user.githubConnection) });
});

export const getGithubOAuthDiagnostics = asyncHandler(async (req, res) => {
  assertGithubOAuthConfigured();
  const redirectUri = githubCallbackUrl(req);
  const authorizeUrl = githubAuthorizeRedirectUrl({ redirectUri, state: 'diagnostic-state-redacted' });
  const url = new URL(authorizeUrl);

  res.json({
    success: true,
    data: {
      configured: true,
      clientId: env.GITHUB_CLIENT_ID,
      callbackUrl: redirectUri,
      githubOAuthAppCallbackUrl: redirectUri,
      frontendOrigin: env.CLIENT_ORIGINS[0] ?? '',
      requiredScopes: requiredGithubScopes,
      authorizeUrlScope: url.searchParams.get('scope') ?? '',
      authorizeUrlPreview: `${url.origin}${url.pathname}?client_id=${env.GITHUB_CLIENT_ID ? 'configured' : 'missing'}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(githubOAuthScope)}&state=redacted`,
    },
  });
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

  const repos = await listAllGithubRepositories(token);
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

async function listAllGithubRepositories(token) {
  const repositories = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageRepos = await githubJson(
      `/user/repos?per_page=100&page=${page}&sort=updated&visibility=all&affiliation=owner,collaborator,organization_member`,
      token,
    );
    if (!Array.isArray(pageRepos) || !pageRepos.length) break;
    repositories.push(...pageRepos);
    if (pageRepos.length < 100) break;
  }
  return repositories;
}

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

export const checkGithubRepositoryAccess = asyncHandler(async (req, res) => {
  const owner = String(req.query.owner ?? '').trim();
  const repo = String(req.query.repo ?? '').trim();
  const workflowPath = String(req.query.workflowPath ?? '.github/workflows/infraflow-development-deploy.yml').replace(/^\/+/, '');
  if (!owner || !repo) throw new ApiError(400, 'GitHub owner and repository are required to check access.');

  const connection = await GitHubConnection.findOne({ userId: req.user._id });
  const grantedScopes = normalizeGithubScopes(connection?.scopes ?? []);
  const missingScopes = missingGithubScopes(grantedScopes);
  if (connection && missingScopes.length) {
    return res.json({
      success: true,
      data: {
        owner,
        repo,
        workflowPath,
        canReadRepository: false,
        canPushContents: false,
        hasWorkflowScope: false,
        canWriteWorkflowFile: false,
        missing: [`GitHub OAuth scopes: ${missingScopes.join(', ')}`],
        ok: false,
        reconnectRequired: true,
        requiredScopes: requiredGithubScopes,
        grantedScopes,
        missingScopes,
        message: reconnectRequiredMessage(missingScopes),
      },
    });
  }

  const token = await githubTokenForUser(req.user._id);
  if (!token) throw new ApiError(409, 'Connect GitHub before checking repository access.');

  const result = {
    owner,
    repo,
    workflowPath,
    canReadRepository: false,
    canPushContents: false,
    hasWorkflowScope: false,
    canWriteWorkflowFile: false,
    missing: [],
  };

  result.hasWorkflowScope = hasRequiredGithubScopes(grantedScopes);

  const repository = await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
  result.canReadRepository = true;
  result.canPushContents = Boolean(repository.permissions?.push || repository.permissions?.admin || repository.permissions?.maintain);

  if (!result.canPushContents) result.missing.push('repository contents write access');
  if (!result.hasWorkflowScope) result.missing.push(`GitHub OAuth scopes: ${missingScopes.join(', ')}`);

  try {
    const path = encodeURIComponentPath(workflowPath);
    await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, token);
    result.canWriteWorkflowFile = result.canPushContents && result.hasWorkflowScope;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    result.canWriteWorkflowFile = result.canPushContents && result.hasWorkflowScope;
  }

  res.json({
    success: true,
    data: {
      ...result,
      ok: result.canReadRepository && result.canPushContents && result.hasWorkflowScope && result.canWriteWorkflowFile,
      reconnectRequired: !result.hasWorkflowScope,
      requiredScopes: requiredGithubScopes,
      grantedScopes,
      missingScopes,
      message: result.missing.length
        ? `GitHub access is incomplete: ${result.missing.join(', ')}. Reconnect GitHub and approve ${githubOAuthScope} access.`
        : 'GitHub repository access is ready.',
    },
  });
});

export async function githubTokenForUser(userId) {
  const connection = await GitHubConnection.findOne({ userId }).select('+accessTokenEncrypted');
  if (!connection?.accessTokenEncrypted) return '';
  const missingScopes = missingGithubScopes(connection.scopes ?? []);
  if (missingScopes.length) {
    connection.reconnectRequired = true;
    connection.missingScopes = missingScopes;
    await connection.save();
    throw new ApiError(409, reconnectRequiredMessage(missingScopes), githubReconnectRequiredDetails(connection.scopes ?? []));
  }
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
  return normalizeGithubCallbackUrl(env.GITHUB_OAUTH_CALLBACK_URL) || `${req.protocol}://${req.get('host')}/api/v1/github/oauth/callback`;
}

function normalizeGithubCallbackUrl(value) {
  const callbackUrl = String(value ?? '').trim();
  if (!callbackUrl) return '';

  try {
    const url = new URL(callbackUrl);
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/api/v1/github/oauth/callback';
    }
    return url.toString();
  } catch {
    return callbackUrl;
  }
}

function safeReturnTo(value) {
  const returnTo = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/settings';
  return returnTo.slice(0, 240);
}

function serializeConnection(connection, userGithubConnection) {
  if (!connection) {
    const grantedScopes = normalizeGithubScopes(userGithubConnection?.scopes ?? []);
    const missingScopes = grantedScopes.length ? missingGithubScopes(grantedScopes) : [];
    return {
      connected: false,
      login: userGithubConnection?.login ?? '',
      username: userGithubConnection?.login ?? '',
      avatarUrl: userGithubConnection?.avatarUrl ?? '',
      scopes: grantedScopes,
      reconnectRequired: missingScopes.length > 0,
      requiredScopes: requiredGithubScopes,
      grantedScopes,
      missingScopes,
    };
  }

  const profile = connection.toSafeProfile();
  const missingScopes = missingGithubScopes(profile.scopes ?? []);
  return {
    ...profile,
    missingScopes,
    reconnectRequired: missingScopes.length > 0,
    requiredScopes: requiredGithubScopes,
  };
}

function finishGithubOAuth(req, res, { success, message, mode = 'redirect', returnTo = '/settings', details }) {
  if (mode === 'popup') {
    return res.type('html').send(popupHtml(success, message, returnTo, details));
  }

  const redirectUrl = frontendRedirectUrl(returnTo, success, message, details);
  return res.redirect(redirectUrl);
}

function frontendRedirectUrl(returnTo, success, message, details) {
  const origin = env.CLIENT_ORIGINS[0] ?? 'http://localhost:5173';
  const url = new URL(safeReturnTo(returnTo), origin);
  url.searchParams.set('github', success ? 'connected' : 'error');
  if (message) url.searchParams.set('github_message', String(message).slice(0, 160));
  if (details?.reconnectRequired) url.searchParams.set('github_reconnect_required', 'true');
  return url.toString();
}

function popupHtml(success, message, returnTo = '/settings', details) {
  const payload = JSON.stringify({ type: 'infraflow:github-connected', success, message, details });
  const origins = JSON.stringify(env.CLIENT_ORIGINS.length ? env.CLIENT_ORIGINS : ['*']);
  const fallbackUrl = JSON.stringify(frontendRedirectUrl(returnTo, success, message, details));
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

async function clearGithubConnectionSummary(userId) {
  const user = await User.findById(userId);
  if (!user) return;
  await GitHubConnection.deleteOne({ userId: user._id });
  user.githubConnection = undefined;
  await user.save();
}

function reconnectRequiredMessage(missingScopes) {
  return `GitHub access is incomplete: missing OAuth scope${missingScopes.length === 1 ? '' : 's'} ${missingScopes.join(', ')}. Reconnect GitHub and approve ${githubOAuthScope} access.`;
}

function githubDeniedMessage(message) {
  const text = String(message || '').trim();
  if (/access_denied/i.test(text)) return 'GitHub authorization was denied. Reconnect GitHub and approve the requested repo workflow access.';
  return text || 'GitHub authorization was denied. Reconnect GitHub and approve the requested repo workflow access.';
}

function logGithubScopes(event, { requiredScopes = [], requestedScopes = [], grantedScopes = [], missingScopes = [] }) {
  console.info('[github-oauth]', event, {
    requiredScopes: normalizeGithubScopes(requiredScopes),
    requestedScopes: normalizeGithubScopes(requestedScopes),
    grantedScopes: normalizeGithubScopes(grantedScopes),
    missingScopes: normalizeGithubScopes(missingScopes),
  });
}
