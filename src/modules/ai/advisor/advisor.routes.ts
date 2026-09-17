import { Router } from "express";
import * as ctrl from "./advisor.controller";
import * as conversationalCtrl from "./conversational-advisor.controller";
import { attachUserIfPresent, requireAuth } from "../../../middlewares/auth.middleware";
import { validate } from "../../../middlewares/validate.middleware";
import { aiChatSchema } from "../../../schemas/ai.schema";
import { aiLimiter } from "../../../middlewares/rate-limit.middleware";

const router = Router();

// New conversational endpoint (primary)
router.post("/conversational", attachUserIfPresent, aiLimiter, validate({ body: aiChatSchema }), conversationalCtrl.conversationalChat);

// Legacy endpoint (for backwards compatibility)
router.post("/", attachUserIfPresent, aiLimiter, validate({ body: aiChatSchema }), ctrl.chat);

// Conversation management
router.get("/conversations", ...requireAuth, conversationalCtrl.listConversations);
router.get("/:id", ...requireAuth, conversationalCtrl.getConversation);
router.delete("/:id", ...requireAuth, conversationalCtrl.deleteConversation);

export default router;
