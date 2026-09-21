import { Router } from "express";
import * as ctrl from "./security-intelligence.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";

const router = Router();

// 21. Account Security Center Overview
router.get("/overview", ...requireAuth, ctrl.getSecurityOverview);

// 22. Active Sessions & Device Manager
router.get("/sessions", ...requireAuth, ctrl.getActiveSessions);
// Recording a device requires a verified session: without one there is no user
// to own the record (or its "New Device Detected" notification).
router.post("/sessions/record", ...requireAuth, ctrl.recordSession);
router.delete("/sessions/:id", ...requireAuth, ctrl.revokeSession);
router.post("/sessions/revoke-all", ...requireAuth, ctrl.revokeAllOtherSessions);

// 23. Login Risk
router.post("/login-risk", ...requireAuth, ctrl.evaluateLoginRisk);

// 24. Transaction Risk
router.post("/transaction-risk", ...requireAuth, ctrl.evaluateTransactionRisk);

// 25. ATO Alerts
router.get("/ato-alerts", ...requireAuth, ctrl.getAtoAlerts);

// 26. Security Timeline
router.get("/timeline", ...requireAuth, ctrl.getSecurityTimeline);

export default router;
