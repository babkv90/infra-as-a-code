const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const TOKEN_KEY = 'infra-auth-token';
const USER_KEY = 'infra-auth-user';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  workspace?: string;
  status: string;
};

type AuthResponse = {
  success: boolean;
  message?: string;
  data?: {
    accessToken: string;
    user: AuthUser;
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

export type LoginPayload = {
  email: string;
  password: string;
};

export type RegisterPayload = LoginPayload & {
  name: string;
  workspaceName?: string;
};

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

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY);
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

export function storeAuthSession(accessToken: string, user: AuthUser) {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
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
