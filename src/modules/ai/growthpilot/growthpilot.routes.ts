import { Router } from "express";
import * as ctrl from "./growthpilot.controller";
import { requireAuth, attachUserIfPresent } from "../../../middlewares/auth.middleware";
import { requireRole } from "../../../middlewares/role.middleware";

const router = Router();

// Public / storefront dynamic value propositions (can be called by any visitor on a product page)
router.get("/dynamic-value-props/:productId", ctrl.getDynamicValueProps);
router.get("/dynamic-value-prop/:productId", ctrl.getDynamicValueProps);

// Protected Seller / Admin Growth Engine
router.use(...requireAuth);
router.use(requireRole("seller", "admin"));

router.get("/overview", ctrl.getOverview);
router.post("/orchestrate-campaign", ctrl.orchestrateCampaign);

export default router;
