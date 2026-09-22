import { Router } from "express";
import * as ctrl from "./ai.controller";
import { runProductFinder } from "./product-finder.controller";
import advisorRoutes from "./advisor/advisor.routes";
import adminCopilotRoutes from "./admin-copilot/admin-copilot.routes";
import sellerCopilotRoutes from "./seller-copilot/seller-copilot.routes";
import customerCopilotRoutes from "./customer-copilot/customer-copilot.routes";
import deliveryCopilotRoutes from "./delivery-copilot/delivery-copilot.routes";
import commerceCompanionRoutes from "./commerce-companion.routes";
import aiCoreRoutes from "./core/ai-core.routes";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";

import { requireRole } from "../../middlewares/role.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { aiLimiter } from "../../middlewares/rate-limit.middleware";
import { visualSearchImageUpload } from "../../middlewares/upload.middleware";
import {
  aiCompareSchema,
  aiDescriptionSchema,
  aiPricingSchema,
  aiRecommendSchema,
  aiReviewSummarySchema,
  aiVisualSearchSchema,
  aiAnalyzeImagesSchema,
  aiGenerateProductSchema,
  aiTranslateSchema,
  aiSuggestPriceSchema,
  aiProductFinderSchema,
} from "../../schemas/ai.schema";

const router = Router();

router.use(aiLimiter);

// 0. Unified ShopNest AI Intelligence Core Gateway
router.use("/core", attachUserIfPresent, aiCoreRoutes);

// ShopNest AI Commerce Companion - unified customer assistant
router.use("/commerce-companion", commerceCompanionRoutes);

// POST /api/v1/ai/advisor (conversational endpoint)
router.use("/advisor", advisorRoutes);

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

// AI Visual Search Endpoints
router.post(
  "/visual-search/upload",
  visualSearchImageUpload.single("image"),
  ctrl.uploadVisualSearchImage
);
router.post(
  "/visual-search",
  attachUserIfPresent,
  validate({ body: aiVisualSearchSchema }),
  ctrl.visualSearch
);
router.get(
  "/visual-search/demands",
  ...requireAuth,
  requireRole("seller", "admin"),
  ctrl.getVisualSearchDemands
);
router.patch(
  "/visual-search/demands/:id/status",
  ...requireAuth,
  requireRole("seller", "admin"),
  ctrl.updateVisualSearchDemandStatus
);

// 36. AI Commerce Memory
router.get("/memory", attachUserIfPresent, ctrl.getAiCommerceMemory);
router.delete("/memory", attachUserIfPresent, ctrl.clearAiCommerceMemory);

// 37. AI Shopping Negotiator
router.post("/negotiate", attachUserIfPresent, ctrl.negotiateDeal);

// 38. AI Shopping Intent Detector
router.post("/detect-intent", attachUserIfPresent, ctrl.detectShoppingIntent);

// 39. Multi-Role AI Commerce Copilot
router.post("/copilot", attachUserIfPresent, ctrl.commerceCopilot);

// 41. AI Product Creation Studio - Image Analysis
router.post(
  "/analyze-product-images",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiAnalyzeImagesSchema }),
  ctrl.analyzeProductImages
);

// 42. AI Product Creation Studio - Generate Content from Images
router.post(
  "/generate-product-from-images",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiGenerateProductSchema }),
  ctrl.generateProductFromImages
);

// 43. AI Product Creation Studio - Translate Content
router.post(
  "/translate-content",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiTranslateSchema }),
  ctrl.translateProductContent
);

// 44. AI Product Creation Studio - Suggest Price
router.post(
  "/suggest-product-price",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiSuggestPriceSchema }),
  ctrl.suggestProductPrice
);

// 45. AI Product Finder - Complete research pipeline
router.post(
  "/product-finder/pipeline",
  ...requireAuth,
  requireRole("seller", "admin"),
  validate({ body: aiProductFinderSchema }),
  runProductFinder
);

// 40. Admin Copilot - AI-powered marketplace intelligence (ADMIN ONLY)
router.use("/admin-copilot", adminCopilotRoutes);
import adminAiRoutes from "../admin-ai/admin-ai.routes";
router.use("/admin-os", adminAiRoutes);

// Seller Copilot - AI-powered seller business intelligence (SELLER ONLY)
router.use("/seller-copilot", sellerCopilotRoutes);

// Customer Copilot - AI-powered customer shopping assistant (CUSTOMER ONLY)
router.use("/customer-copilot", customerCopilotRoutes);

// Delivery Copilot - AI-powered delivery partner operational assistant (DELIVERY_MAN ONLY)
router.use("/delivery-copilot", deliveryCopilotRoutes);

// AI Provider Health Check (no auth required - only shows config, no secrets)

router.get("/health", ctrl.aiHealth);

export default router;
