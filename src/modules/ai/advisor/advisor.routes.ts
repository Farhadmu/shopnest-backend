import { Router } from "express";
import * as ctrl from "./advisor.controller";
import { attachUserIfPresent, requireAuth } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { aiChatSchema } from "../../../schemas/ai.schema";
import { aiLimiter } from "../../../middlewares/rate-limit.middleware";

const router = Router();

router.post("/", attachUserIfPresent, aiLimiter, validate({ body: aiChatSchema }), ctrl.chat);
router.get("/:id", ...requireAuth, ctrl.getConversation);

export default router;
