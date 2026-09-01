import { Router } from "express";
import * as ctrl from "./security-center.controller";

const router = Router();

// 1. Security Overview
router.get("/overview", ctrl.getSecurityOverview);

// 2. Security Health Score
router.get("/health", ctrl.getSecurityHealth);

// 3. Login Security Monitor
router.get("/logins", ctrl.getLoginSecurity);

// 4. Suspicious Activity Detection
router.get("/suspicious-activity", ctrl.getSuspiciousActivity);

// 5. Account Security
router.get("/users", ctrl.getAccountSecurity);
router.patch("/users/:id/status", ctrl.updateUserStatus);

// 6. Seller Security
router.get("/sellers", ctrl.getSellerSecurity);

// 7. API & Request Security
router.get("/api-security", ctrl.getApiSecurity);

// 8. Security Incidents
router.get("/incidents", ctrl.getSecurityIncidents);
router.patch("/incidents/:id", ctrl.updateIncidentStatus);

// 9. Security Alerts
router.get("/alerts", ctrl.getSecurityAlerts);
router.patch("/alerts/:id/resolve", ctrl.resolveAlert);

// 10. Audit Log
router.get("/audit-logs", ctrl.getSecurityAuditLogs);

// 11. Security Analytics
router.get("/analytics", ctrl.getSecurityAnalytics);

// 12. Security Recommendations
router.get("/recommendations", ctrl.getSecurityRecommendations);

export default router;
