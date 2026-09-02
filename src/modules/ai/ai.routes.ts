import { Router } from "express";
import * as ctrl from "./ai.controller";
import advisorRoutes from "./advisor/advisor.routes";
import adminCopilotRoutes from "./admin-copilot/admin-copilot.routes";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { aiLimiter } from "../../middlewares/rate-limit.middleware";
import {
  aiCompareSchema,
  aiDescriptionSchema,
  aiPricingSchema,
  aiRecommendSchema,
  aiReviewSummarySchema,
  aiVisualSearchSchema,
} from "../../schemas/ai.schema";

const router = Router();

router.use(aiLimiter);

// POST /api/v1/ai/chat
router.use("/chat", advisorRoutes);

// POST /api/v1/ai/recommend - public, but personalizes more if logged in
router.post("/recommend", attachUserIfPresent, validate({ body: aiRecommendSchema }), ctrl.recommend);

// POST /api/v1/ai/product-description - sellers only
router.post(
  "/product-description",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiDescriptionSchema }),
  ctrl.productDescription
);

// POST /api/v1/ai/review-summary - public
router.post("/review-summary", validate({ body: aiReviewSummarySchema }), ctrl.reviewSummary);

// POST /api/v1/ai/compare - public
router.post("/compare", validate({ body: aiCompareSchema }), ctrl.compareProducts);

// POST /api/v1/ai/pricing - sellers only
router.post(
  "/pricing",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiPricingSchema }),
  ctrl.pricingSuggestion
);

// POST /api/v1/ai/visual-search - public
router.post("/visual-search", validate({ body: aiVisualSearchSchema }), ctrl.visualSearch);

// 36. AI Commerce Memory
router.get("/memory", attachUserIfPresent, ctrl.getAiCommerceMemory);
router.delete("/memory", attachUserIfPresent, ctrl.clearAiCommerceMemory);

// 37. AI Shopping Negotiator
router.post("/negotiate", attachUserIfPresent, ctrl.negotiateDeal);

// 38. AI Shopping Intent Detector
router.post("/detect-intent", attachUserIfPresent, ctrl.detectShoppingIntent);

// 39. Multi-Role AI Commerce Copilot
router.post("/copilot", attachUserIfPresent, ctrl.commerceCopilot);

// 40. Admin Copilot - AI-powered marketplace intelligence (ADMIN ONLY)
router.use("/admin-copilot", adminCopilotRoutes);

export default router;
