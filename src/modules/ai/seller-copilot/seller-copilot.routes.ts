import { Router } from "express";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";
import { sellerCopilotController } from "./seller-copilot.controller";

const router = Router();

router.post("/", ...requireAuth, requireRole("seller"), sellerCopilotController);

export default router;
