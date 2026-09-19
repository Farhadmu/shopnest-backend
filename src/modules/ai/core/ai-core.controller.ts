import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { AiCoreService } from "./ai-core.service";
import { AiHandoffService } from "./ai-handoff.service";
import { AIExperience, UserRole } from "./ai-types";

export const chatWithCore = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, aiType, conversationId, sessionId, currentPage, handoffId } = req.body;
  if (!prompt || typeof prompt !== "string") {
    throw ApiError.badRequest("Prompt is required and must be text.");
  }

  const user = req.user;
  const role = (user?.role as UserRole) || "guest";
  const experience: AIExperience = (aiType as AIExperience) || "ADVISOR";

  const result = await AiCoreService.processTurn({
    prompt,
    aiType: experience,
    role,
    userId: user?.id ? String(user.id) : undefined,
    sellerId: (user as any)?.sellerId || (role === "seller" ? String(user?.id) : undefined),
    deliveryManId: (user as any)?.deliveryManId || (role === "delivery_man" ? String(user?.id) : undefined),
    conversationId,
    sessionId,
    currentPage,
    handoffId,
  });

  sendSuccess(res, result);
});

export const createHandoffToken = asyncHandler(async (req: Request, res: Response) => {
  const { from, to, productIds, orderIds, deliveryIds, conversationSummary, suggestedAction, preferences } = req.body;
  if (!from || !to) throw ApiError.badRequest("'from' and 'to' AI experiences are required");

  const handoff = AiHandoffService.createHandoff({
    from,
    to,
    userId: req.user?.id ? String(req.user.id) : undefined,
    productIds,
    orderIds,
    deliveryIds,
    conversationSummary,
    suggestedAction,
    preferences,
  });

  sendSuccess(res, handoff, undefined, 201);
});

export const consumeHandoffToken = asyncHandler(async (req: Request, res: Response) => {
  const { handoffId } = req.params;
  if (!handoffId) throw ApiError.badRequest("handoffId is required");

  const handoff = AiHandoffService.consumeHandoff(handoffId);
  if (!handoff) throw ApiError.notFound("Handoff context not found or expired.");

  sendSuccess(res, handoff);
});
