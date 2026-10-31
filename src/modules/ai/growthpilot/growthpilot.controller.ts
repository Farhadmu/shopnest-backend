import { Request, Response } from "express";
import { GrowthPilotService } from "./growthpilot.service";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";

export async function getOverview(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const overview = await GrowthPilotService.getOverview(userId);
  return sendSuccess(res, overview, "GrowthPilot overview retrieved successfully");
}

export async function orchestrateCampaign(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required");
  }

  const { productId, targetAudience } = req.body;
  if (!productId) {
    throw ApiError.badRequest("productId is required to orchestrate multi-channel campaign");
  }

  const campaigns = await GrowthPilotService.orchestrateMultiChannelCampaign(userId, productId, targetAudience);
  return sendSuccess(res, campaigns, "Multi-channel marketing campaigns orchestrated successfully");
}

export async function getDynamicValueProps(req: Request, res: Response) {
  const { productId } = req.params;
  if (!productId) {
    throw ApiError.badRequest("productId is required");
  }

  const props = await GrowthPilotService.generateDynamicValueProps(productId);
  return sendSuccess(res, props, "Dynamic value propositions generated");
}
