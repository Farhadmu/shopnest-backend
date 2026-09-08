import { Router } from "express";
import * as ctrl from "./coupon.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createCouponSchema } from "../../schemas/coupon.schema";

const router = Router();

router.get("/validate/:code", ctrl.validateCoupon);
router.get("/", ...requireAuth, requireRole("seller", "admin"), ctrl.listCoupons);
router.post("/", ...requireAuth, requireRole("seller", "admin"), validate({ body: createCouponSchema }), ctrl.createCoupon);
router.delete("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.deleteCoupon);

export default router;
