import { Request, Response } from "express";
import { getSettingsSingleton } from "./admin-settings.model";
import { Category } from "../categories/category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** GET /admin/settings - admin only. Current category allocation limit + how many are locked per seller. */
export const getAdminSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  
  // Get per-seller locked category counts
  const sellerLockedCounts = await Category.aggregate([
    { $match: { is_locked: true } },
    { $group: { _id: "$assigned_seller_id", count: { $sum: 1 } } },
    { $project: { sellerId: "$_id", count: 1, _id: 0 } },
  ]);
  
  const lockedCategoriesCount = await Category.countDocuments({ is_locked: true });
  sendSuccess(res, { ...settings.toJSON(), lockedCategoriesCount, sellerLockedCounts });
});

/** PATCH /admin/settings - admin only. Updates the per-seller max active/locked coupon-category limit. */
export const updateAdminSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  
  // Check per-seller: no seller should exceed the new limit
  const sellerLockedCounts = await Category.aggregate([
    { $match: { is_locked: true } },
    { $group: { _id: "$assigned_seller_id", count: { $sum: 1 } } },
  ]);
  
  const maxSellerLocked = sellerLockedCounts.length > 0 
    ? Math.max(...sellerLockedCounts.map(s => s.count)) 
    : 0;
  
  if (req.body.category_length < maxSellerLocked) {
    throw ApiError.badRequest(
      `Cannot set the limit below ${maxSellerLocked} categories already locked to a single seller.`
    );
  }

  settings.category_length = req.body.category_length;
  await settings.save();
  
  const lockedCategoriesCount = await Category.countDocuments({ is_locked: true });
  const updatedSellerLockedCounts = await Category.aggregate([
    { $match: { is_locked: true } },
    { $group: { _id: "$assigned_seller_id", count: { $sum: 1 } } },
    { $project: { sellerId: "$_id", count: 1, _id: 0 } },
  ]);
  
  sendSuccess(res, { ...settings.toJSON(), lockedCategoriesCount, sellerLockedCounts: updatedSellerLockedCounts }, "Category limit updated");
});
