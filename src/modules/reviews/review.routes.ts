import { Router } from "express";
import * as ctrl from "./review.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// Admin moderation surface (nested product review routes live in products.routes.ts)
router.get("/", ...requireAuth, requireRole("admin"), ctrl.listAllReviewsForModeration);
router.delete("/:id", ...requireAuth, requireRole("admin"), ctrl.deleteReview);

export default router;
