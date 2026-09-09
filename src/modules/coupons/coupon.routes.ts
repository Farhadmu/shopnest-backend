import { Router } from "express";
import * as ctrl from "./coupon.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { createCouponSchema, rejectCouponSchema, reportCouponSchema, validateCouponSchema } from "../../schemas/coupon.schema";

const router = Router();

// Public
router.post("/validate/:code", validate({ body: validateCouponSchema }), ctrl.validateCoupon);
router.get("/public/homepage", ctrl.getPublicHomepageCoupons);
router.get("/public/store/:sellerId", ctrl.getPublicStoreCoupons);

// Seller + Admin
router.get("/category-limit", ...requireAuth, requireRole("seller", "admin"), ctrl.getCategoryLimit);
router.get("/", ...requireAuth, requireRole("seller", "admin"), ctrl.listCoupons);
router.post("/", ...requireAuth, requireRole("seller", "admin"), validate({ body: createCouponSchema }), ctrl.createCoupon);
router.put("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.updateCoupon);
router.delete("/:id", ...requireAuth, requireRole("seller", "admin"), ctrl.deleteCoupon);

// Admin only
router.get("/homepage-queue", ...requireAuth, requireRole("admin"), ctrl.getHomepageQueueStatus);
router.patch("/:id/approve", ...requireAuth, requireRole("admin"), ctrl.approveCoupon);
router.patch(
  "/:id/reject",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: rejectCouponSchema }),
  ctrl.rejectCoupon
);
router.patch(
  "/:id/report",
  ...requireAuth,
  requireRole("admin"),
  validate({ body: reportCouponSchema }),
  ctrl.reportCoupon
);
router.patch("/:id/resolve-report", ...requireAuth, requireRole("admin"), ctrl.resolveReportCoupon);

export default router;
