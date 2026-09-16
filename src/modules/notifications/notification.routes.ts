import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import * as ctrl from "./notification.controller";

const router = Router();
router.use(...requireAuth);

// Customer/seller notifications
router.get("/", ctrl.listNotifications);
router.get("/unread-count", ctrl.unreadCount);
router.patch("/read-all", ctrl.markAllRead);
router.patch("/:id/read", ctrl.markRead);

// Static `/clear-read` MUST be registered before `/:id`: Express matches in
// registration order, so `DELETE /clear-read` was being captured as
// `DELETE /:id` with id="clear-read" and blew up on the ObjectId conversion.
router.delete("/clear-read", ctrl.clearReadNotifications);
router.delete("/:id", ctrl.deleteNotification);

// Admin notification endpoints
const adminRouter = Router();
adminRouter.use(requireRole("admin"));

adminRouter.get("/", ctrl.listAdminNotifications);
adminRouter.get("/stats", ctrl.getAdminNotificationStats);
adminRouter.get("/unread-count", ctrl.getAdminUnreadCount);
adminRouter.patch("/read-all", ctrl.markAllAdminNotificationsRead);
adminRouter.patch("/bulk-read", ctrl.bulkMarkAdminNotificationsRead);
adminRouter.patch("/:id/read", ctrl.markAdminNotificationRead);
adminRouter.patch("/:id/unread", ctrl.markAdminNotificationUnread);

export { router as default, adminRouter };
