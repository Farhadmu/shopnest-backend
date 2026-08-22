import { Request, Response } from "express";
import { Notification } from "./notification.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess, sendPaginated } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** GET /notifications - current user's notifications, paginated, newest first. */
export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));

  const filter = { userId: req.user!.id };
  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);

  sendPaginated(
    res,
    items.map((n) => n.toJSON()),
    total,
    page,
    limit
  );
});

/** GET /notifications/unread-count */
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await Notification.countDocuments({ userId: req.user!.id, isRead: false });
  sendSuccess(res, { count });
});

/** PATCH /notifications/:id/read */
export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await Notification.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!notification) throw ApiError.notFound("Notification not found");

  notification.isRead = true;
  await notification.save();

  sendSuccess(res, notification.toJSON(), "Notification marked as read");
});

/** PATCH /notifications/read-all */
export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany({ userId: req.user!.id, isRead: false }, { $set: { isRead: true } });
  sendSuccess(res, { success: true }, "All notifications marked as read");
});
