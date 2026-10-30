import { Router } from "express";
import * as ctrl from "./customer-fraud.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Admin-only customer fraud intelligence endpoints
router.get("/customers", ...requireAuth, requireRole("admin"), ctrl.getFraudCustomers);
router.get("/customers/:userId", ...requireAuth, requireRole("admin"), ctrl.getCustomerFraudDossier);
router.patch("/customers/:userId/status", ...requireAuth, requireRole("admin"), ctrl.updateCustomerFraudStatus);
router.post("/scan", ...requireAuth, requireRole("admin"), ctrl.triggerGlobalFraudScan);

export default router;
