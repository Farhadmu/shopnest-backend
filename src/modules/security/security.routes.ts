import { Router } from "express";
import * as ctrl from "./security.controller";
import securityIntelligenceRoutes from "./security-intelligence.routes";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Sub-routes for Security Intelligence & Session Manager
router.use("/", securityIntelligenceRoutes);

router.use(...requireAuth, requireRole("admin"));

router.get("/logs", ctrl.listSecurityLogs);
router.patch("/logs/:id/resolve", ctrl.resolveSecurityLog);

export default router;
