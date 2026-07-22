import { Notification } from '../models/Notification.js';

export async function createNotification(payload) {
  try {
    return await Notification.create(payload);
  } catch (error) {
    console.error('Failed to create notification', error.message);
    return null;
  }
}
