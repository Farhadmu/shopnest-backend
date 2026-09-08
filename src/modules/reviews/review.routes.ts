import { Router } from "express";
import * as ctrl from "./review.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Admin moderation surface (nested product review routes live in products.routes.ts)
router.get("/", ...requireAuth, requireRole("admin"), ctrl.listAllReviewsForModeration);
router.get("/stats", ...requireAuth, requireRole("admin"), ctrl.getReviewStats);
router.get("/search", ...requireAuth, requireRole("admin"), ctrl.searchAdminReviews);
router.patch("/:id/dismiss", ...requireAuth, requireRole("admin"), ctrl.dismissReport);
router.patch("/:id/hide", ...requireAuth, requireRole("admin"), ctrl.hideReview);
router.delete("/:id", ...requireAuth, requireRole("admin"), ctrl.removeReviewAdmin);

export default router;
