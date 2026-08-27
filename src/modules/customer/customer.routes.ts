import { Router } from "express";
import * as ctrl from "./customer.controller";
import { attachUserIfPresent } from "../../middlewares/auth.middleware";

const router = Router();

// 1. Shopping Journey
router.get("/journey", attachUserIfPresent, ctrl.getShoppingJourney);
router.post("/journey/event", attachUserIfPresent, ctrl.recordJourneyEvent);

// 2. Budget Planner
router.post("/budget-planner", ctrl.generateBudgetPlan);

// 3. Compatibility Checker
router.post("/compatibility-check", ctrl.checkProductCompatibility);

// 4. Bundles
router.get("/bundles/:productId", ctrl.getProductBundle);

// 5. Lifecycle Tracker
router.get("/lifecycle", attachUserIfPresent, ctrl.getProductLifecycle);
router.patch("/lifecycle/:id/maintenance", attachUserIfPresent, ctrl.updateMaintenanceReminder);

// 6. Personal Goals
router.get("/goals", attachUserIfPresent, ctrl.getGoals);
router.post("/goals", attachUserIfPresent, ctrl.createGoal);
router.patch("/goals/:id", attachUserIfPresent, ctrl.updateGoal);
router.delete("/goals/:id", attachUserIfPresent, ctrl.deleteGoal);

// 7. Price History
router.get("/products/:productId/price-history", ctrl.getPriceHistory);

// 8. Purchase Decision Score
router.get("/products/:productId/decision-score", ctrl.getPurchaseDecisionScore);

// 9. Product Trust & Authenticity Checker
router.get("/products/:productId/trust-checker", ctrl.getProductTrustChecker);

// 10. Return Risk Preview
router.get("/products/:productId/return-risk", ctrl.getReturnRiskPreview);

// 11. Personal Shopping Insights & Spending Analytics
router.get("/spending-analytics", attachUserIfPresent, ctrl.getSpendingAnalytics);

// 12. Wishlist Analytics & Price Drops
router.get("/wishlist-analytics", attachUserIfPresent, ctrl.getWishlistAnalytics);

// 13. Saved Searches
router.get("/saved-searches", attachUserIfPresent, ctrl.getSavedSearches);
router.post("/saved-searches", attachUserIfPresent, ctrl.createSavedSearch);
router.delete("/saved-searches/:id", attachUserIfPresent, ctrl.deleteSavedSearch);

// 14. Personalized Offers
router.get("/personalized-offers", attachUserIfPresent, ctrl.getPersonalizedOffers);

// 15. Customer Activity Timeline
router.get("/activity-timeline", attachUserIfPresent, ctrl.getCustomerActivityTimeline);

export default router;
