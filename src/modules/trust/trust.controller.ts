import { Request, Response } from "express";
import { Store } from "../sellers/store.model";
import { computeTrustBreakdown } from "./trust.service";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

export const getStoreTrust = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.params;
  const breakdown = await computeTrustBreakdown(storeId);
  if (!breakdown) throw ApiError.notFound("Store not found");
  sendSuccess(res, breakdown);
});

/** GET /trust/me - convenience for the logged-in seller's own trust score */
export const getMyTrust = asyncHandler(async (req: Request, res: Response) => {
  const store = await Store.findOne({ ownerId: req.user!.id });
  if (!store) throw ApiError.notFound("You do not have a store yet");
  const breakdown = await computeTrustBreakdown(store.id);
  sendSuccess(res, breakdown);
});
