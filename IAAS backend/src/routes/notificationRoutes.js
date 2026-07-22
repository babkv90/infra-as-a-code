import { Router } from 'express';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);
notificationRouter.get('/', listNotifications);
notificationRouter.post('/read-all', markAllNotificationsRead);
notificationRouter.post('/:id/read', markNotificationRead);
