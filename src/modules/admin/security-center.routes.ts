import { Router } from "express";
import * as overviewCtrl from "./features/security-center/overview.controller";
import * as healthCtrl from "./features/security-center/health.controller";
import * as loginMonitorCtrl from "./features/security-center/login-monitor.controller";
import * as suspiciousActivityCtrl from "./features/security-center/suspicious-activity.controller";
import * as accountSecurityCtrl from "./features/security-center/account-security.controller";
import * as sellerSecurityCtrl from "./features/security-center/seller-security.controller";
import * as apiSecurityCtrl from "./features/security-center/api-security.controller";
import * as alertsCtrl from "./features/security-center/alerts.controller";
import * as auditLogsCtrl from "./features/security-center/audit-logs.controller";
import * as analyticsCtrl from "./features/security-center/analytics.controller";
import * as recommendationsCtrl from "./features/security-center/recommendations.controller";

const router = Router();

// 1. Security Overview
router.get("/overview", overviewCtrl.getSecurityOverview);

// 2. Security Health Score
router.get("/health", healthCtrl.getSecurityHealth);

// 3. Login Security Monitor
router.get("/logins", loginMonitorCtrl.getLoginSecurity);

// 4. Suspicious Activity Detection
router.get("/suspicious-activity", suspiciousActivityCtrl.getSuspiciousActivity);

// 5. Account Security
router.get("/users", accountSecurityCtrl.getAccountSecurity);
router.patch("/users/:id/status", accountSecurityCtrl.updateUserStatus);

// 6. Seller Security
router.get("/sellers", sellerSecurityCtrl.getSellerSecurity);

// 7. API & Request Security
router.get("/api-security", apiSecurityCtrl.getApiSecurity);

// 8. Security Alerts
router.get("/alerts", alertsCtrl.getSecurityAlerts);
router.patch("/alerts/:id/resolve", alertsCtrl.resolveAlert);

// 9. Audit Log
router.get("/audit-logs", auditLogsCtrl.getSecurityAuditLogs);

// 10. Security Analytics
router.get("/analytics", analyticsCtrl.getSecurityAnalytics);

// 11. Security Recommendations
router.get("/recommendations", recommendationsCtrl.getSecurityRecommendations);

export default router;
