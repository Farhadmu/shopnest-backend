import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import * as ctrl from "./notification.controller";

const router = Router();
router.use(...requireAuth);
router.get("/", ctrl.listNotifications);
router.get("/unread-count", ctrl.unreadCount);
router.patch("/read-all", ctrl.markAllRead);
router.patch("/:id/read", ctrl.markRead);

export default router;
