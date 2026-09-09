import { Router } from "express";
import * as ctrl from "./admin.controller";
import * as settingsCtrl from "../settings/admin-settings.controller";
import { validate } from "../../middlewares/validate.middleware";
import { updateAdminSettingsSchema } from "../../schemas/admin-settings.schema";
import adminIntelligenceRoutes from "./admin-intelligence.routes";
import securityCenterRoutes from "./security-center.routes";
import orderRiskRoutes from "../risk/order-risk.routes";
import { adminRouter as adminNotificationRouter } from "../notifications/notification.routes";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Apply admin authorization to all routes
router.use(...requireAuth, requireRole("admin"));

// Sub-routes for Admin Intelligence & Marketplace Hub
router.use("/", adminIntelligenceRoutes);

// Security Center routes
router.use("/security-center", securityCenterRoutes);

// Order Risk Assessment routes
router.use("/order-risk", orderRiskRoutes);

// Admin notifications
router.use("/notifications", adminNotificationRouter);

// Core admin routes
router.get("/dashboard", ctrl.getDashboardMetrics);
router.get("/sellers", ctrl.listSellersForModeration);
router.get("/sellers/:id", ctrl.getSellerDetailsForAdmin);
router.patch("/sellers/:id/status", ctrl.updateSellerStatus);
router.get("/reviews/reported", ctrl.listReportedReviews);

// Platform settings (category allocation limit)
router.get("/settings", settingsCtrl.getAdminSettings);
router.patch("/settings", validate({ body: updateAdminSettingsSchema }), settingsCtrl.updateAdminSettings);

export default router;
