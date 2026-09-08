import { Router } from "express";
import * as ctrl from "./coupon.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createCouponSchema, rejectCouponSchema } from "../../schemas/coupon.schema";

const router = Router();

// Public
router.get("/validate/:code", ctrl.validateCoupon);
router.get("/public/homepage", ctrl.getPublicHomepageCoupons);
router.get("/public/store/:sellerId", ctrl.getPublicStoreCoupons);

// Seller + Admin
router.get("/", ...requireAuth, requireRole("seller", "admin"), ctrl.listCoupons);
router.post("/", ...requireAuth, requireRole("seller", "admin"), validate({ body: createCouponSchema }), ctrl.createCoupon);
router.put("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.updateCoupon);
router.delete("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.deleteCoupon);

// Admin only
router.patch("/:id/approve", ...requireAuth, requireRole("admin"), ctrl.approveCoupon);
router.patch(
  "/:id/reject",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: rejectCouponSchema }),
  ctrl.rejectCoupon
);

export default router;
