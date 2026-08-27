import { Router } from "express";
import * as ctrl from "./seller-intelligence.controller";
import { attachUserIfPresent } from "../../middlewares/auth.middleware";

const router = Router();

// 11. Health Score
router.get("/health-score", attachUserIfPresent, ctrl.getSellerHealthScore);

// 12. Sales Forecast
router.get("/sales-forecast", attachUserIfPresent, ctrl.getSalesForecast);

// 13. Demand Heatmap
router.get("/demand-heatmap", attachUserIfPresent, ctrl.getDemandHeatmap);

// 14. Growth Simulator
router.post("/simulator/growth", attachUserIfPresent, ctrl.simulateGrowthScenario);

// 15. Campaign Simulator
router.post("/simulator/campaign", attachUserIfPresent, ctrl.simulateCampaign);

// 16. Customer Segments
router.get("/segments", attachUserIfPresent, ctrl.getCustomerSegments);

// 17. Churn Predictor
router.get("/churn-risk", attachUserIfPresent, ctrl.getChurnPredictor);

// 18. Profitability
router.get("/profitability", attachUserIfPresent, ctrl.getProfitabilityAnalysis);

// 19. Goals & KPIs
router.get("/goals", attachUserIfPresent, ctrl.getSellerGoals);
router.post("/goals", attachUserIfPresent, ctrl.createSellerGoal);
router.delete("/goals/:id", attachUserIfPresent, ctrl.deleteSellerGoal);

// 20. A/B Testing Experiments
router.get("/experiments", attachUserIfPresent, ctrl.getAbExperiments);
router.post("/experiments", attachUserIfPresent, ctrl.createAbExperiment);

// 21. Advanced Seller Analytics
router.get("/analytics", attachUserIfPresent, ctrl.getSellerAnalytics);

// 22. Smart Inventory Intelligence
router.get("/inventory-intelligence", attachUserIfPresent, ctrl.getInventoryIntelligence);

// 23. Customer Insights
router.get("/customer-insights", attachUserIfPresent, ctrl.getCustomerInsights);

export default router;
