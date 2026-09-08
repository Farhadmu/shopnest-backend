import { Router } from "express";
import * as ctrl from "./trust.controller";
import { requireAuth } from "../../middlewares/auth.middleware";
import { requireRole } from "../../middlewares/role.middleware";

const router = Router();

router.get("/sellers/:storeId", ctrl.getStoreTrust);
router.get("/me", ...requireAuth, requireRole("seller", "admin"), ctrl.getMyTrust);

export default router;
