import { apiRequest as sharedApiRequest } from '../utils/apiClient';

const notificationRequest = <T,>(path: string, init?: RequestInit) => sharedApiRequest<T>(path, init, 'Notification request failed');

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
