import { Router } from "express";
import * as ctrl from "./profit-calculator.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { calculateProfitSchema } from "../../schemas/profit-calculator.schema";

const router = Router();

router.use(...requireAuth);
router.use(requireRole("seller", "admin"));

router.post("/calculate", validate({ body: calculateProfitSchema }), ctrl.calculateProfit);
router.get("/history", ctrl.getProfitHistory);

export default router;
