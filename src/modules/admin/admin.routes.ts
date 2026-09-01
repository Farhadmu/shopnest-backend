import { Router } from "express";
import * as ctrl from "./admin.controller";
import adminIntelligenceRoutes from "./admin-intelligence.routes";
import securityCenterRoutes from "./security-center.routes";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Apply admin authorization to all routes
router.use(...requireAuth, requireRole("admin"));

// Sub-routes for Admin Intelligence & Marketplace Hub
router.use("/", adminIntelligenceRoutes);

// Security Center routes
router.use("/security-center", securityCenterRoutes);

// Core admin routes
router.get("/dashboard", ctrl.getDashboardMetrics);
router.get("/sellers", ctrl.listSellersForModeration);
router.patch("/sellers/:id/status", ctrl.updateSellerStatus);
router.get("/reviews/reported", ctrl.listReportedReviews);

export default router;
