import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { UserPreferences } from "../customer-features.model";
import { SearchHistory } from "../customer-features.model";
import { CustomerActivity } from "../customer-extras.model";
import { ShoppingJourney } from "../customer-intelligence.model";

export const getShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let preferences = await UserPreferences.findOne({ userId });

  if (!preferences) {
    preferences = await UserPreferences.create({
      userId, preferredCategories: [], typicalBudgetMin: 0, typicalBudgetMax: 50000,
      preferredSellers: [], preferredDelivery: "any", favoriteBrands: [], shoppingInterests: [], allowPersonalization: true,
    });
  }

  sendSuccess(res, preferences);
});

export const updateShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const preferences = await UserPreferences.findOneAndUpdate(
    { userId }, { $set: req.body }, { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  sendSuccess(res, preferences, "Shopping profile updated");
});

export const resetShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await UserPreferences.findOneAndDelete({ userId });
  sendSuccess(res, { success: true }, "Shopping profile reset");
});

export const deletePersonalizationData = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await Promise.all([
    UserPreferences.findOneAndDelete({ userId }),
    CustomerActivity.deleteMany({ userId }),
    SearchHistory.deleteMany({ userId }),
    ShoppingJourney.deleteMany({ userId }),
  ]);
  sendSuccess(res, { success: true }, "Personalization data deleted");
});

// ============================================================
// 1. BANGLA + BANGLISH SMART SEARCH (Feature 1)
// ============================================================
