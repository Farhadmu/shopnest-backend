import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";
import { adminCopilotController } from "./admin-copilot.controller";

const router = Router();

router.post("/", ...requireAuth, requireRole("admin"), adminCopilotController);

export default router;
