import { API_BASE_URL } from '../utils/apiBaseUrl';

const USER_KEY = 'infra-auth-user';

// The access token lives only in this module's memory — never in localStorage, where any script that
// runs on the page could read it. A reload or a new tab starts without one, and refreshSession()
// trades the httpOnly refresh cookie (which page scripts can't read) for a fresh one. The cached user
// in localStorage is not a credential; it only lets the UI render roles before the API answers.
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthUser | null> | null = null;

// Earlier builds kept the token in localStorage; drop any copy left behind.
const LEGACY_TOKEN_KEY = 'infra-auth-token';
try { window.localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* Storage is optional. */ }

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  workspace?: string;
  workspaceName?: string;
  workspacePlan?: string;
  accessPlan?: string;
  demoCredits?: number;
  creditRequest?: {
    status?: string;
    requestedCredits?: number;
    reason?: string;
    note?: string;
  };
  status: string;
  legalConsent?: {
    termsVersionAccepted?: string;
    privacyVersionAccepted?: string;
    acceptedAt?: string | null;
    acceptedIp?: string;
  };
};

type AuthResponse = {
  success: boolean;
  message?: string;
  data?: {
    accessToken: string;
    user: AuthUser;
    // Only from /auth/oauth/exchange: a one-time account notice to show before continuing.
    notice?: 'password_removed' | null;
  };
};

type ForgotPasswordResponse = {
  success: boolean;
  message?: string;
  data?: {
    resetToken?: string;
    expiresAt?: string;
  };
};

type ResetPasswordResponse = {
  success: boolean;
  message?: string;
};

type MeResponse = {
  success: boolean;
  message?: string;
  data?: {
    user: AuthUser;
  };
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = LoginPayload & {
  name: string;
  workspaceName?: string;
  acceptTerms: true;
};

export type OAuthProvider = {
  id: 'google' | 'github';
  name: string;
};

// The browser's half of the sign-in binding: a random verifier kept in this tab while the user is
// away at Google/GitHub, whose SHA-256 (the challenge) goes to the backend at /start. Only this tab
// can later redeem the ticket the backend hands back — see services/oauthLogin.js.
const OAUTH_VERIFIER_KEY = 'infra-oauth-verifier';

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/oauth/providers`);
    const result = await response.json().catch(() => null);
    return response.ok && Array.isArray(result?.data?.providers) ? result.data.providers : [];
  } catch {
    return [];
  }
}

export async function startOAuthSignIn(providerId: OAuthProvider['id'], next: string) {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  window.sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({ client_challenge: challenge, next, origin: window.location.origin });
  window.location.assign(`${API_BASE_URL}/auth/oauth/${providerId}/start?${params}`);
}

export async function completeOAuthSignIn(ticket: string) {
  const verifier = window.sessionStorage.getItem(OAUTH_VERIFIER_KEY);
  window.sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
  if (!verifier) {
    throw new Error('This sign-in was started in a different tab or browser. Please sign in again.');
  }

  const response = await fetch(`${API_BASE_URL}/auth/oauth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ticket, verifier }),
  });
  const result = (await response.json().catch(() => null)) as AuthResponse | null;

  if (!response.ok || !result?.success || !result.data?.accessToken) {
    throw new Error(result?.message ?? 'Sign-in failed. Please try again.');
  }

  storeAuthSession(result.data.accessToken, result.data.user);
  return result.data;
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login(payload: LoginPayload) {
  return authRequest('/auth/login', payload);
}

export async function register(payload: RegisterPayload) {
  return authRequest('/auth/register', payload);
}

export async function forgotPassword(payload: Pick<LoginPayload, 'email'>) {
  const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => null)) as ForgotPasswordResponse | null;
  

  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Could not request password reset. Please try again.');
  }

  return result;
}

export async function resetPassword(payload: { token: string; password: string }) {
  const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => null)) as ResetPasswordResponse | null;

  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Could not reset password. Please request a new reset token.');
  }

  return result;
}

export async function logout() {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      credentials: 'include',
    });
  } finally {
    clearAuthSession();
  }
}

export function getAccessToken() {
  return accessToken;
}

// Trades the refresh cookie for a new access token (and the current user). Concurrent callers — a
// page's parallel requests all hitting 401 at once — share one request. Resolves null when the
// session is gone (no cookie, expired, revoked) and clears the local session.
export function refreshSession(): Promise<AuthUser | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      const result = (await response.json().catch(() => null)) as AuthResponse | null;
      if (!response.ok || !result?.success || !result.data?.accessToken) {
        clearAuthSession();
        return null;
      }
      storeAuthSession(result.data.accessToken, result.data.user);
      return result.data.user;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// fetch() for authenticated API calls: attaches the bearer token and, on a 401 (token expired or
// missing after a reload), refreshes once and retries. If the refresh fails, the original 401
// response is returned for the caller to report.
export async function authFetch(url: string, init: RequestInit = {}) {
  const send = () =>
    fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

  const response = await send();
  if (response.status !== 401) return response;
  return (await refreshSession()) ? send() : response;
}

export function getStoredUser(): AuthUser | null {
  const value = window.localStorage.getItem(USER_KEY);
  if (!value) return null;

  try {
    return JSON.parse(value) as AuthUser;
  } catch {
    return null;
  }
}

export function storeAuthSession(token: string, user: AuthUser) {
  accessToken = token;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  accessToken = null;
  window.localStorage.removeItem(USER_KEY);
}

// Resolves the signed-in user, or null. After a reload there is no access token in memory, so this
// restores one from the refresh cookie. A visitor with no cached user has never signed in on this
// browser (or signed out), so it skips the round trip and answers null straight away.
export async function validateStoredSession() {
  if (!accessToken) {
    return getStoredUser() ? refreshSession() : null;
  }

  const response = await authFetch(`${API_BASE_URL}/auth/me`);
  const result = (await response.json().catch(() => null)) as MeResponse | null;

  if (!response.ok || !result?.success || !result.data?.user) {
    clearAuthSession();
    return null;
  }

  window.localStorage.setItem(USER_KEY, JSON.stringify(result.data.user));
  return result.data.user;
}

async function authRequest(path: string, payload: LoginPayload | RegisterPayload) {

  
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => null)) as AuthResponse | null;

  if (!response.ok || !result?.success || !result.data?.accessToken) {
    throw new Error(result?.message ?? 'Authentication failed. Please try again.');
  }


  storeAuthSession(result.data.accessToken, result.data.user);
  return result.data;
}
