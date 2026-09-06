import { Request, Response } from "express";
import { Notification } from "./notification.model";
import { asyncHandler } from "../../utils/async-handler";
import { ApiError } from "../../utils/api-error";

/**
 * Controller: List Notifications For Logged-In User
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 *    - req.query: page (default 1), limit (default 20, max 50)
 * 2. Database Operation:
 *    - Notification.find({ userId }).sort({ createdAt: -1 }).skip(...).limit(...)
 *    - Notification.countDocuments({ userId })
 * 3. Response Sent:
 *    - HTTP 200: { success: true, items: [...], total, page, limit, totalPages }
 */
export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const userId = req.user!.id;
  const filter = { userId };

  const [docs, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    items: docs.map((d) => d.toJSON()),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

/**
 * Controller: Get Count of Unread Notifications
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 * 2. Database Operation:
 *    - Notification.countDocuments({ userId, isRead: false })
 * 3. Response Sent:
 *    - HTTP 200: { success: true, count: number }
 */
export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await Notification.countDocuments({ userId: req.user!.id, isRead: false });
  res.status(200).json({ success: true, count });
});

/**
 * Controller: Mark Single Notification as Read
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 *    - req.params.id: Notification ID
 * 2. Database Operation:
 *    - Notification.findOneAndUpdate({ _id: id, userId }, { isRead: true }, { new: true })
 * 3. Response Sent:
 *    - HTTP 200: { success: true, ...notificationDetails }
 */
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id },
    { isRead: true },
    { new: true }
  );

  if (!notification) throw ApiError.notFound("Notification not found");

  res.status(200).json({ success: true, ...notification.toJSON() });
});

/**
 * Controller: Mark All Notifications as Read
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated user ID
 * 2. Database Operation:
 *    - Notification.updateMany({ userId, isRead: false }, { isRead: true })
 * 3. Response Sent:
 *    - HTTP 200: { success: true }
 */
export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany(
    { userId: req.user!.id, isRead: false },
    { isRead: true }
  );

  res.status(200).json({ success: true });
});
