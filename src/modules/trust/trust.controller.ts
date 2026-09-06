import { Request, Response } from "express";
import { Store } from "../sellers/store.model";
import { computeTrustBreakdown } from "./trust.service";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/**
 * Controller: Get Trust Score Breakdown For A Store
 *
 * 1. Inputs Extracted:
 *    - req.params.storeId: Store ID
 * 2. Database Operation:
 *    - Calls computeTrustBreakdown(storeId) which analyzes order delivery rate, dispute history, and review ratings
 * 3. Response Sent:
 *    - HTTP 200: TrustBreakdown { storeId, trustScore, factors: { fulfillmentRate, avgRating, disputeRate, accountAgeDays } }
 */
export const getStoreTrust = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.params;
  const breakdown = await computeTrustBreakdown(storeId);
  if (!breakdown) throw ApiError.notFound("Store not found");
  sendSuccess(res, breakdown);
});

/**
 * Controller: Get Authenticated Seller's Own Trust Score
 *
 * 1. Inputs Extracted:
 *    - req.user.id: Authenticated seller ID
 * 2. Database Operation:
 *    - Store.findOne({ ownerId: userId })
 *    - computeTrustBreakdown(store.id)
 * 3. Response Sent:
 *    - HTTP 200: TrustBreakdown object for the current seller's store
 */
export const getMyTrust = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.notFound("You do not have a store yet");
  const breakdown = await computeTrustBreakdown(store.id);
  sendSuccess(res, breakdown);
});
