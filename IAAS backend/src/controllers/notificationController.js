import { Notification } from '../models/Notification.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function visibilityFilter(req) {
  return {
    workspace: req.user.workspace,
    $or: [{ user: { $exists: false } }, { user: req.user._id }],
  };
}

export const listNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find(visibilityFilter(req)).sort({ createdAt: -1 }).limit(50);
  const unreadCount = await Notification.countDocuments({ ...visibilityFilter(req), read: false });
  res.json({ success: true, data: { notifications, unreadCount } });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, ...visibilityFilter(req) },
    { read: true },
    { new: true },
  );
  if (!notification) throw new ApiError(404, 'Notification not found');
  res.json({ success: true, data: notification });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ ...visibilityFilter(req), read: false }, { read: true });
  res.json({ success: true, data: { updated: true } });
});
