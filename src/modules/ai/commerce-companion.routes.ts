import { Router } from "express";
import * as ctrl from "./commerce-companion.controller";
import { attachUserIfPresent, requireAuth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { aiLimiter } from "../../middlewares/rate-limit.middleware";
import { z } from "zod";

const router = Router();

const commerceCompanionSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
  currentPage: z.object({
    route: z.string().optional(),
    productId: z.string().optional(),
    orderId: z.string().optional(),
  }).optional(),
});

router.post("/", attachUserIfPresent, aiLimiter, validate({ body: commerceCompanionSchema }), ctrl.chat);
router.get("/:id", ...requireAuth, ctrl.getConversation);

export default router;
