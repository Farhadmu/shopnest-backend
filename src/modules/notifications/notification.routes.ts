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
