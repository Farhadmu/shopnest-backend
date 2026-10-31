import { Request, Response } from "express";
import { DemandIQService } from "./demandiq.service";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";

export async function getOverview(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const overview = await DemandIQService.getStoreDemandIQOverview(userId);
  return sendSuccess(res, overview, "DemandIQ overview retrieved successfully");
}

export async function simulateShock(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const { scenarioType, delayDays, demandMultiplier, affectedCategory } = req.body;
  if (!scenarioType) {
    throw ApiError.badRequest("scenarioType is required");
  }

  const result = await DemandIQService.simulateShockScenario(userId, {
    scenarioType,
    delayDays: delayDays ? Number(delayDays) : undefined,
    demandMultiplier: demandMultiplier ? Number(demandMultiplier) : undefined,
    affectedCategory,
  });

  return sendSuccess(res, result, "Supply chain shock simulation completed");
}

export async function procurementChat(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const { query, conversationHistory } = req.body;
  if (!query || typeof query !== "string") {
    throw ApiError.badRequest("A prompt or query is required");
  }

  const result = await DemandIQService.queryProcurementAnalyst(userId, query, conversationHistory);
  return sendSuccess(res, result, "Procurement response generated");
}

export async function generatePurchaseOrder(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const { targetServiceLevel, leadTimeDays } = req.body || {};
  const proposal = await DemandIQService.generatePurchaseOrderPlan(userId, {
    targetServiceLevel: targetServiceLevel ? Number(targetServiceLevel) : undefined,
    leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
  });

  return sendSuccess(res, proposal, "Purchase order generated successfully");
}
