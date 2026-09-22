import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";
import * as ctrl from "./admin-ai.controller";

const router = Router();

// Strict RBAC: All Admin AI endpoints require authenticated Administrator session
router.use(...requireAuth, requireRole("admin"));

router.post("/chat", ctrl.handleAdminAiChat);
router.post("/confirm", ctrl.handleAdminAiConfirmAction);
router.get("/briefing", ctrl.getAdminAiBriefing);

export default router;
