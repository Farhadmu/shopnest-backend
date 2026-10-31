import { Request, Response } from "express";
import { HyperPersonalService } from "./hyperpersonal.service";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";

export async function getNextBestAction(req: Request, res: Response) {
  const userId = req.user?.id;
  const nba = await HyperPersonalService.getNextBestAction(userId);
  return sendSuccess(res, nba, "Next Best Action retrieved successfully");
}

export async function getCustomerGenome(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication required to view Customer Genome");
  }

  const genome = await HyperPersonalService.getCustomerGenome(userId);
  return sendSuccess(res, genome, "Customer Genome Profile retrieved successfully");
}

export async function sentimentChat(req: Request, res: Response) {
  const userId = req.user?.id;
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    throw ApiError.badRequest("Message is required");
  }

  const response = await HyperPersonalService.processSentimentAdaptiveChat(message, userId);
  return sendSuccess(res, response, "Sentiment adaptive response generated");
}

export async function getCulturalContext(req: Request, res: Response) {
  const { productId } = req.params;
  const region = (req.query.region as string) || "Bangladesh & South Asia";
  if (!productId) {
    throw ApiError.badRequest("productId is required");
  }

  const context = await HyperPersonalService.getCulturalContextualization(productId, region);
  return sendSuccess(res, context, "Cultural contextualization retrieved");
}
