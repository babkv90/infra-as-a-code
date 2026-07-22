import { getStoredToken } from '../auth/authClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export type NotificationRecord = {
  _id: string;
  type: 'deployment' | 'destroy' | 'pipeline';
  status: 'success' | 'failed';
  title: string;
  message: string;
  errorLog?: string;
  resourceType: 'Deployment' | 'ApplicationPipeline';
  resourceId: string;
  resourceName?: string;
  read: boolean;
  createdAt: string;
};

export async function listNotifications() {
  return notificationRequest<{ notifications: NotificationRecord[]; unreadCount: number }>('/notifications');
}

export async function markNotificationRead(id: string) {
  return notificationRequest<NotificationRecord>(`/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return notificationRequest<{ updated: boolean }>('/notifications/read-all', { method: 'POST' });
}

async function notificationRequest<T>(path: string, init: RequestInit = {}) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message ?? 'Notification request failed');
  }

  return result.data as T;
}
