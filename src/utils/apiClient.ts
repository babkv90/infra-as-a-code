import { authFetch } from '../auth/authClient';
import { API_BASE_URL } from './apiBaseUrl';

export { API_BASE_URL };

async function unwrap<T>(response: Response, fallbackMessage: string): Promise<T> {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    if (response.status === 429) {
      throw new Error(result?.message ? `429: ${result.message}` : '429: Too many requests');
    }
    if (response.status === 402) {
      throw new Error(result?.message ? `402: ${result.message}` : '402: Out of credits');
    }
    throw new Error(result?.message ?? fallbackMessage);
  }
  return result.data as T;
}

// Shared JSON request helper used by every API client module — goes through authFetch (bearer
// token, one refresh-and-retry on 401), sets
// the JSON content type, and unwraps the backend's {success,data,message} envelope into a thrown
// Error on failure. A few call sites have genuinely different contracts and intentionally don't
// use this: authClient.ts's validateStoredSession() returns null instead of throwing (App.tsx's
// auth guard needs a falsy sentinel, not a catchable exception), ticketApi.ts's
// fetchTicketAttachmentBlobUrl() reads a Blob rather than JSON, and terraformPayloadApi.ts returns
// the whole response envelope rather than just its `data` field.
export async function apiRequest<T>(path: string, init: RequestInit = {}, fallbackMessage = 'Request failed'): Promise<T> {
  const response = await authFetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  return unwrap<T>(response, fallbackMessage);
}

// Same as apiRequest, but for multipart/form-data uploads — no Content-Type header, so the
// browser can set the multipart boundary itself.
export async function apiFormRequest<T>(path: string, form: FormData, fallbackMessage = 'Request failed'): Promise<T> {
  const response = await authFetch(`${API_BASE_URL}${path}`, { method: 'POST', body: form });
  return unwrap<T>(response, fallbackMessage);
}
