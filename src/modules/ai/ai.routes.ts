import { Router } from "express";
import * as ctrl from "./ai.controller";
import { runProductFinder } from "./product-finder.controller";
import advisorRoutes from "./advisor/advisor.routes";
import adminCopilotRoutes from "./admin-copilot/admin-copilot.routes";
import customerCopilotRoutes from "./customer-copilot/customer-copilot.routes";
import sellerCopilotRoutes from "./seller-copilot/seller-copilot.routes";
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
  aiAnalyzeImagesSchema,
  aiGenerateProductSchema,
  aiTranslateSchema,
  aiSuggestPriceSchema,
  aiProductFinderSchema,
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

// 39. Customer Copilot - AI shopping assistant (CUSTOMER ONLY)
router.use("/customer-copilot", customerCopilotRoutes);

// 40. Seller Copilot - AI store management & business advisor (SELLER ONLY)
router.use("/seller-copilot", sellerCopilotRoutes);

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

// 46. Admin Copilot - AI-powered marketplace intelligence (ADMIN ONLY)
router.use("/admin-copilot", adminCopilotRoutes);

export default router;
