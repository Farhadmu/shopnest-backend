import { Router } from "express";
import * as ctrl from "./spending-analytics.controller";
import { requireAuth } from "../../middlewares/auth.middleware";

const router = Router();

router.get("/analytics", requireAuth, ctrl.getComprehensiveSpendingAnalytics);
router.get("/budget", requireAuth, ctrl.getBudgetTracker);
router.post("/budget", requireAuth, ctrl.updateBudget);
router.get("/report/export", requireAuth, ctrl.getSpendingReport);

export default router;
