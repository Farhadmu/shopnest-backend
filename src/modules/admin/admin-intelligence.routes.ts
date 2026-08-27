import { Router } from "express";
import * as ctrl from "./admin-intelligence.controller";
import { attachUserIfPresent } from "../../middlewares/auth.middleware";

const router = Router();

// 27. Command Center Metrics
router.get("/command-center", attachUserIfPresent, ctrl.getCommandCenterMetrics);

// 28. Marketplace Activity Map
router.get("/marketplace-map", attachUserIfPresent, ctrl.getMarketplaceMap);

// 29. Anomalies
router.get("/anomalies", attachUserIfPresent, ctrl.getAnomalies);
router.patch("/anomalies/:id/resolve", attachUserIfPresent, ctrl.resolveAnomaly);

// 30. Marketplace Health Index
router.get("/marketplace-health", attachUserIfPresent, ctrl.getMarketplaceHealthIndex);

// 31. Revenue Leakage
router.get("/revenue-leakage", attachUserIfPresent, ctrl.getRevenueLeakage);

// 32. Seller Risk Ranking
router.get("/seller-risk-ranking", attachUserIfPresent, ctrl.getSellerRiskRanking);

// 33. Marketplace Forecast
router.get("/marketplace-forecast", attachUserIfPresent, ctrl.getMarketplaceForecast);

// 34. Category Intelligence
router.get("/category-intelligence", attachUserIfPresent, ctrl.getCategoryIntelligence);

// 35. System Telemetry & Bottleneck Detector
router.get("/system-telemetry", attachUserIfPresent, ctrl.getSystemTelemetry);

// 36. Platform Analytics with Date Filters
router.get("/platform-analytics", attachUserIfPresent, ctrl.getPlatformAnalytics);

// 37. Rule-Based Fraud & Risk Detection Matrix
router.get("/risk-matrix", attachUserIfPresent, ctrl.getRiskMatrix);

// 38. Security Incident Management
router.get("/incidents", attachUserIfPresent, ctrl.getSecurityIncidents);
router.patch("/incidents/:id", attachUserIfPresent, ctrl.updateSecurityIncident);
router.post("/incidents/:id/notes", attachUserIfPresent, ctrl.addIncidentNote);

// 39. Admin Audit Log
router.get("/audit-logs", attachUserIfPresent, ctrl.getAuditLogs);

export default router;
