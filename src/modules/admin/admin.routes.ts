import { Router } from "express";
import * as ctrl from "./admin.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.use(...requireAuth, requireRole("admin"));

router.get("/dashboard", ctrl.getDashboardMetrics);
router.get("/sellers", ctrl.listSellersForModeration);
router.patch("/sellers/:id/status", ctrl.updateSellerStatus);
router.get("/reviews/reported", ctrl.listReportedReviews);

export default router;
