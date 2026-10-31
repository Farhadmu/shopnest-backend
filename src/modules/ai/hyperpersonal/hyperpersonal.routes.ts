import { Router } from "express";
import * as ctrl from "./hyperpersonal.controller";
import { attachUserIfPresent, requireAuth } from "../../../middlewares/auth.middleware";

const router = Router();

// Storefront & public personalized touchpoints (works with or without login)
router.get("/next-best-action", attachUserIfPresent, ctrl.getNextBestAction);
router.post("/sentiment-chat", attachUserIfPresent, ctrl.sentimentChat);
router.get("/cultural-context/:productId", ctrl.getCulturalContext);

// Customer-specific Customer Genome (Requires Login)
router.get("/genome", ...requireAuth, ctrl.getCustomerGenome);

export default router;
