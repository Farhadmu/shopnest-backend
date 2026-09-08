import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import * as commandCenter from "./features/command-center.controller";
import * as marketplaceMap from "./features/marketplace-map.controller";
import * as anomalies from "./features/anomalies.controller";
import * as healthIndex from "./features/health-index.controller";
import * as revenueLeakage from "./features/revenue-leakage.controller";
import * as sellerRiskRanking from "./features/seller-risk-ranking.controller";
import * as marketplaceForecast from "./features/marketplace-forecast.controller";
import * as categoryIntelligence from "./features/category-intelligence.controller";
import * as systemTelemetry from "./features/system-telemetry.controller";
import * as platformAnalytics from "./features/platform-analytics.controller";
import * as riskMatrix from "./features/risk-matrix.controller";
import * as suspiciousOrders from "./features/suspicious-orders.controller";
import * as financialRisk from "./features/financial-risk.controller";
import * as fraudAlerts from "./features/fraud-alerts.controller";
import * as securityIncidents from "./features/security-incidents.controller";
import * as auditLogs from "./features/audit-logs.controller";

const router = Router();

// 27. Command Center Metrics
router.get("/command-center", commandCenter.getCommandCenterMetrics);

// 28. Marketplace Activity Map
router.get("/marketplace-map", marketplaceMap.getMarketplaceMap);

// 29. Anomalies
router.get("/anomalies", anomalies.getAnomalies);
router.patch("/anomalies/:id/resolve", anomalies.resolveAnomaly);

// 30. Marketplace Health Index
router.get("/marketplace-health", healthIndex.getMarketplaceHealthIndex);

// 31. Revenue Leakage
router.get("/revenue-leakage", revenueLeakage.getRevenueLeakage);

// 32. Seller Risk Ranking
router.get("/seller-risk-ranking", sellerRiskRanking.getSellerRiskRanking);

// 33. Marketplace Forecast
router.get("/marketplace-forecast", marketplaceForecast.getMarketplaceForecast);

// 34. Category Intelligence
router.get("/category-intelligence", categoryIntelligence.getCategoryIntelligence);

// 35. System Telemetry & Bottleneck Detector
router.get("/system-telemetry", systemTelemetry.getSystemTelemetry);

// 36. Platform Analytics with Date Filters
router.get("/platform-analytics", platformAnalytics.getPlatformAnalytics);

// 37. Rule-Based Fraud & Risk Detection Matrix
router.get("/risk-matrix", riskMatrix.getRiskMatrix);

// 37b. Suspicious Orders Detection
router.get("/suspicious-orders", suspiciousOrders.getSuspiciousOrders);

// 37c. Financial Risk Exposure
router.get("/financial-risk", financialRisk.getFinancialRisk);

// 37d. Fraud Alerts
router.get("/fraud-alerts", fraudAlerts.getFraudAlerts);

// 38. Security Incident Management
router.get("/incidents", securityIncidents.getSecurityIncidents);
router.get("/incidents/stats", securityIncidents.getIncidentStatsRoute);
router.post("/incidents", ...requireAuth, requireRole("admin"), securityIncidents.createSecurityIncident);
router.get("/incidents/:id", securityIncidents.getSecurityIncidentById);
router.patch("/incidents/:id", ...requireAuth, requireRole("admin"), securityIncidents.updateSecurityIncident);
router.patch("/incidents/:id/status", ...requireAuth, requireRole("admin"), securityIncidents.updateIncidentStatusRoute);
router.patch("/incidents/:id/severity", ...requireAuth, requireRole("admin"), securityIncidents.updateIncidentSeverityRoute);
router.patch("/incidents/:id/assign", ...requireAuth, requireRole("admin"), securityIncidents.assignIncidentRoute);
router.patch("/incidents/:id/unassign", ...requireAuth, requireRole("admin"), securityIncidents.unassignIncidentRoute);
router.post("/incidents/:id/notes", ...requireAuth, requireRole("admin"), securityIncidents.addIncidentNoteRoute);
router.post("/incidents/:id/evidence", ...requireAuth, requireRole("admin"), securityIncidents.addEvidenceRoute);
router.post("/incidents/:id/resolve", ...requireAuth, requireRole("admin"), securityIncidents.resolveIncidentRoute);
router.post("/incidents/:id/close", ...requireAuth, requireRole("admin"), securityIncidents.closeIncidentRoute);
router.post("/incidents/:id/reopen", ...requireAuth, requireRole("admin"), securityIncidents.reopenIncidentRoute);
router.get("/incidents/:id/timeline", securityIncidents.getIncidentTimelineRoute);
router.get("/incidents/:id/security-events", securityIncidents.getRelatedSecurityEventsRoute);
router.get("/incidents/:id/risk-signals", securityIncidents.getRelatedRiskSignalsRoute);

// 39. Admin Audit Log
router.get("/audit-logs", auditLogs.getAuditLogs);

export default router;