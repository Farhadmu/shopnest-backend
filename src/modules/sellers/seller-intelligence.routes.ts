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
import * as commandCenterCtrl from "./features/command-center.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.use(...requireAuth, requireRole("seller", "admin"));

// 10. Unified Seller Command Center
router.get("/command-center", commandCenterCtrl.getSellerCommandCenter);

// 11. Health Score
router.get("/health-score", healthScoreCtrl.getSellerHealthScore);

// 12. Sales Forecast
router.get("/sales-forecast", salesForecastCtrl.getSalesForecast);

// 13. Demand Heatmap
router.get("/demand-heatmap", demandHeatmapCtrl.getDemandHeatmap);

// 14. Growth Simulator
router.post("/simulator/growth", growthSimulatorCtrl.simulateGrowthScenario);

// 15. Campaign Simulator
router.post("/simulator/campaign", campaignSimulatorCtrl.simulateCampaign);

// 16. Customer Segments
router.get("/segments", customerSegmentsCtrl.getCustomerSegments);

// 17. Churn Predictor
router.get("/churn-risk", churnPredictorCtrl.getChurnPredictor);

// 18. Profitability
router.get("/profitability", profitabilityCtrl.getProfitabilityAnalysis);

// 19. Goals & KPIs
router.get("/goals", sellerGoalsCtrl.getSellerGoals);
router.post("/goals", sellerGoalsCtrl.createSellerGoal);
router.delete("/goals/:id", sellerGoalsCtrl.deleteSellerGoal);

// 20. A/B Testing Experiments
router.get("/experiments", abExperimentsCtrl.getAbExperiments);
router.post("/experiments", abExperimentsCtrl.createAbExperiment);

// 21. Advanced Seller Analytics
router.get("/analytics", sellerAnalyticsCtrl.getSellerAnalytics);

// 22. Smart Inventory Intelligence
router.get("/inventory-intelligence", inventoryIntelligenceCtrl.getInventoryIntelligence);

// 23. Customer Insights
router.get("/customer-insights", customerInsightsCtrl.getCustomerInsights);

export default router;
