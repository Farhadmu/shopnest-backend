import { Router } from "express";
import { chatWithCore, createHandoffToken, consumeHandoffToken } from "./ai-core.controller";

const router = Router();

// Unified Chat Gateway (Supports all 5 experiences with Anti-IDOR and Evidence)
router.post("/chat", chatWithCore);

// AI Handoff Producer & Consumer
router.post("/handoff", createHandoffToken);
router.get("/handoff/:handoffId", consumeHandoffToken);

export default router;
