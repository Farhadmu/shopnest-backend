import { Router } from "express";
import * as ctrl from "./seller-intelligence.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

// All seller intelligence routes require authentication AND seller role
const sellerAuth = [...requireAuth, requireRole("seller", "admin")];

// 11. Health Score
router.get("/health-score", ...sellerAuth, ctrl.getSellerHealthScore);

// 12. Sales Forecast
router.get("/sales-forecast", ...sellerAuth, ctrl.getSalesForecast);

// 13. Demand Heatmap
router.get("/demand-heatmap", ...sellerAuth, ctrl.getDemandHeatmap);

// 14. Growth Simulator
router.post("/simulator/growth", ...sellerAuth, ctrl.simulateGrowthScenario);

// 15. Campaign Simulator
router.post("/simulator/campaign", ...sellerAuth, ctrl.simulateCampaign);

// 16. Customer Segments
router.get("/segments", ...sellerAuth, ctrl.getCustomerSegments);

// 17. Churn Predictor
router.get("/churn-risk", ...sellerAuth, ctrl.getChurnPredictor);

// 18. Profitability
router.get("/profitability", ...sellerAuth, ctrl.getProfitabilityAnalysis);

// 19. Goals & KPIs
router.get("/goals", ...sellerAuth, ctrl.getSellerGoals);
router.post("/goals", ...sellerAuth, ctrl.createSellerGoal);
router.delete("/goals/:id", ...sellerAuth, ctrl.deleteSellerGoal);

// 20. A/B Testing Experiments
router.get("/experiments", ...sellerAuth, ctrl.getAbExperiments);
router.post("/experiments", ...sellerAuth, ctrl.createAbExperiment);

// 21. Advanced Seller Analytics
router.get("/analytics", ...sellerAuth, ctrl.getSellerAnalytics);

// 22. Smart Inventory Intelligence
router.get("/inventory-intelligence", ...sellerAuth, ctrl.getInventoryIntelligence);

// 23. Customer Insights
router.get("/customer-insights", ...sellerAuth, ctrl.getCustomerInsights);

export default router;
