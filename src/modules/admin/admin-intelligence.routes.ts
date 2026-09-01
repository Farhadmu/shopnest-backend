import { Router } from "express";
import * as ctrl from "./admin-intelligence.controller";

const router = Router();

// 27. Command Center Metrics
router.get("/command-center", ctrl.getCommandCenterMetrics);

// 28. Marketplace Activity Map
router.get("/marketplace-map", ctrl.getMarketplaceMap);

// 29. Anomalies
router.get("/anomalies", ctrl.getAnomalies);
router.patch("/anomalies/:id/resolve", ctrl.resolveAnomaly);

// 30. Marketplace Health Index
router.get("/marketplace-health", ctrl.getMarketplaceHealthIndex);

// 31. Revenue Leakage
router.get("/revenue-leakage", ctrl.getRevenueLeakage);

// 32. Seller Risk Ranking
router.get("/seller-risk-ranking", ctrl.getSellerRiskRanking);

// 33. Marketplace Forecast
router.get("/marketplace-forecast", ctrl.getMarketplaceForecast);

// 34. Category Intelligence
router.get("/category-intelligence", ctrl.getCategoryIntelligence);

// 35. System Telemetry & Bottleneck Detector
router.get("/system-telemetry", ctrl.getSystemTelemetry);

// 36. Platform Analytics with Date Filters
router.get("/platform-analytics", ctrl.getPlatformAnalytics);

// 37. Rule-Based Fraud & Risk Detection Matrix
router.get("/risk-matrix", ctrl.getRiskMatrix);

// 38. Security Incident Management
router.get("/incidents", ctrl.getSecurityIncidents);
router.patch("/incidents/:id", ctrl.updateSecurityIncident);
router.post("/incidents/:id/notes", ctrl.addIncidentNote);

// 39. Admin Audit Log
router.get("/audit-logs", ctrl.getAuditLogs);

export default router;
