import { Router } from "express";
import * as ctrl from "./demandiq.controller";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";

const router = Router();

router.use(...requireAuth);
router.use(requireRole("seller", "admin"));

router.get("/overview", ctrl.getOverview);
router.post("/simulate-shock", ctrl.simulateShock);
router.post("/procurement-chat", ctrl.procurementChat);
router.post("/generate-po", ctrl.generatePurchaseOrder);

export default router;
