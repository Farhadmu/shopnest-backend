import { Router } from "express";
import * as healthScoreCtrl from "./features/health-score.controller";
import * as salesForecastCtrl from "./features/sales-forecast.controller";
import * as demandHeatmapCtrl from "./features/demand-heatmap.controller";
import * as growthSimulatorCtrl from "./features/growth-simulator.controller";
import * as campaignSimulatorCtrl from "./features/campaign-simulator.controller";
import * as customerSegmentsCtrl from "./features/customer-segments.controller";
import * as churnPredictorCtrl from "./features/churn-predictor.controller";
import * as profitabilityCtrl from "./features/profitability.controller";
import * as sellerGoalsCtrl from "./features/seller-goals.controller";
import * as abExperimentsCtrl from "./features/ab-experiments.controller";
import * as sellerAnalyticsCtrl from "./features/seller-analytics.controller";
import * as inventoryIntelligenceCtrl from "./features/inventory-intelligence.controller";
import * as customerInsightsCtrl from "./features/customer-insights.controller";
import { attachUserIfPresent } from "../../middlewares/auth.middleware";

const router = Router();

// 11. Health Score
router.get("/health-score", attachUserIfPresent, healthScoreCtrl.getSellerHealthScore);

// 12. Sales Forecast
router.get("/sales-forecast", attachUserIfPresent, salesForecastCtrl.getSalesForecast);

// 13. Demand Heatmap
router.get("/demand-heatmap", attachUserIfPresent, demandHeatmapCtrl.getDemandHeatmap);

// 14. Growth Simulator
router.post("/simulator/growth", attachUserIfPresent, growthSimulatorCtrl.simulateGrowthScenario);

// 15. Campaign Simulator
router.post("/simulator/campaign", attachUserIfPresent, campaignSimulatorCtrl.simulateCampaign);

// 16. Customer Segments
router.get("/segments", attachUserIfPresent, customerSegmentsCtrl.getCustomerSegments);

// 17. Churn Predictor
router.get("/churn-risk", attachUserIfPresent, churnPredictorCtrl.getChurnPredictor);

// 18. Profitability
router.get("/profitability", attachUserIfPresent, profitabilityCtrl.getProfitabilityAnalysis);

// 19. Goals & KPIs
router.get("/goals", attachUserIfPresent, sellerGoalsCtrl.getSellerGoals);
router.post("/goals", attachUserIfPresent, sellerGoalsCtrl.createSellerGoal);
router.delete("/goals/:id", attachUserIfPresent, sellerGoalsCtrl.deleteSellerGoal);

// 20. A/B Testing Experiments
router.get("/experiments", attachUserIfPresent, abExperimentsCtrl.getAbExperiments);
router.post("/experiments", attachUserIfPresent, abExperimentsCtrl.createAbExperiment);

// 21. Advanced Seller Analytics
router.get("/analytics", attachUserIfPresent, sellerAnalyticsCtrl.getSellerAnalytics);

// 22. Smart Inventory Intelligence
router.get("/inventory-intelligence", attachUserIfPresent, inventoryIntelligenceCtrl.getInventoryIntelligence);

// 23. Customer Insights
router.get("/customer-insights", attachUserIfPresent, customerInsightsCtrl.getCustomerInsights);

export default router;
