import { Router } from "express";
import * as ctrl from "./order-risk.controller";
import { requireAuth, attachUserIfPresent } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { assessOrderRiskSchema, riskOrderIdParamSchema } from "../../schemas/risk.schema";

const router = Router();

router.get("/:orderId", attachUserIfPresent, validate({ params: riskOrderIdParamSchema }), ctrl.getOrderRisk);
router.post("/assess", ...requireAuth, requireRole("admin"), validate({ body: assessOrderRiskSchema }), ctrl.assessOrderRisk);

export default router;
