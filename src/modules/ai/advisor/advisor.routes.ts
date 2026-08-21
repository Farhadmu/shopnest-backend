import { Router } from "express";
import * as ctrl from "./advisor.controller";
import { requireAuth } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { aiChatSchema } from "../../../schemas/ai.schema";
import { aiLimiter } from "../../../middlewares/rate-limit.middleware";

const router = Router();

router.use(...requireAuth, aiLimiter);
router.post("/", validate({ body: aiChatSchema }), ctrl.chat);
router.get("/:id", ctrl.getConversation);

export default router;
