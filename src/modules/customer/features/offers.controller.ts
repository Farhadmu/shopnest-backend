import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { PersonalizedOffer } from "../customer-extras.model";

// 14. PERSONALIZED OFFERS
export const getPersonalizedOffers = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";
  const offers = await PersonalizedOffer.find({ userId, isClaimed: false });
  sendSuccess(res, offers);
});