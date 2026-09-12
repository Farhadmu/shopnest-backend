import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";
import { customerCopilotController } from "./customer-copilot.controller";

const router = Router();

router.post("/", ...requireAuth, requireRole("customer"), customerCopilotController);

export default router;
