import { Router } from "express";
import * as ctrl from "./notification.controller";
import { requireAuth } from "../../middlewares/auth.middleware";

const router = Router();

router.use(...requireAuth);

router.get("/", ctrl.listNotifications);
router.get("/unread-count", ctrl.getUnreadCount);
router.patch("/read-all", ctrl.markAllNotificationsRead);
router.patch("/:id/read", ctrl.markNotificationRead);

export default router;
