import { Router } from "express";
import * as ctrl from "./security-intelligence.controller";
import { attachUserIfPresent } from "../../middlewares/auth.middleware";

const router = Router();

// 21. Account Security Center Overview
router.get("/overview", attachUserIfPresent, ctrl.getSecurityOverview);

// 22. Active Sessions & Device Manager
router.get("/sessions", attachUserIfPresent, ctrl.getActiveSessions);
router.delete("/sessions/:id", attachUserIfPresent, ctrl.revokeSession);
router.post("/sessions/revoke-all", attachUserIfPresent, ctrl.revokeAllOtherSessions);

// 23. Login Risk
router.post("/login-risk", attachUserIfPresent, ctrl.evaluateLoginRisk);

// 24. Transaction Risk
router.post("/transaction-risk", attachUserIfPresent, ctrl.evaluateTransactionRisk);

// 25. ATO Alerts
router.get("/ato-alerts", attachUserIfPresent, ctrl.getAtoAlerts);

// 26. Security Timeline
router.get("/timeline", attachUserIfPresent, ctrl.getSecurityTimeline);

export default router;
