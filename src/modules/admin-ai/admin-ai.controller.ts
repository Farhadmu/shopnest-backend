import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { AdminAiOrchestrator } from "./admin-ai.orchestrator";
import * as tools from "./admin-ai.tools";

export const handleAdminAiChat = asyncHandler(async (req: Request, res: Response) => {
  const { query, conversationId, pageContext } = req.body as {
    query?: string;
    conversationId?: string;
    pageContext?: any;
  };

  if (!query || typeof query !== "string" || !query.trim()) {
    throw ApiError.badRequest("Query string is required");
  }

  const adminId = req.user!.id;
  const adminName = req.user!.name || "Administrator";

  const result = await AdminAiOrchestrator.processTurn({
    query: query.trim(),
    adminId,
    adminName,
    conversationId,
    pageContext,
  });

  sendSuccess(res, result);
});

export const handleAdminAiConfirmAction = asyncHandler(async (req: Request, res: Response) => {
  const { action } = req.body as { action?: any };

  if (!action || !action.action) {
    throw ApiError.badRequest("Valid action payload is required for confirmation execution");
  }

  const adminId = req.user!.id;
  const adminName = req.user!.name || "Administrator";

  const receipt = await AdminAiOrchestrator.executeAction(action, adminId, adminName);
  sendSuccess(res, { receipt }, "Administrative operation executed and audited successfully");
});

export const getAdminAiBriefing = asyncHandler(async (_req: Request, res: Response) => {
  const briefing = await tools.getMarketplaceBriefing();
  sendSuccess(res, briefing);
});
