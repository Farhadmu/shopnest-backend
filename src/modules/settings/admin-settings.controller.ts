import { Request, Response } from "express";
import { getSettingsSingleton } from "./admin-settings.model";
import { Category } from "../categories/category.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";

/** GET /admin/settings - admin only. Current category allocation limit + how many are locked. */
export const getAdminSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  const lockedCategoriesCount = await Category.countDocuments({ is_locked: true });
  sendSuccess(res, { ...settings.toJSON(), lockedCategoriesCount });
});

/** PATCH /admin/settings - admin only. Updates the global max active/locked coupon-category limit. */
export const updateAdminSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getSettingsSingleton();
  const lockedCategoriesCount = await Category.countDocuments({ is_locked: true });

  if (req.body.category_length < lockedCategoriesCount) {
    throw ApiError.badRequest(
      `Cannot set the limit below the ${lockedCategoriesCount} categor${lockedCategoriesCount === 1 ? "y" : "ies"} already locked to sellers.`
    );
  }

  settings.category_length = req.body.category_length;
  await settings.save();
  sendSuccess(res, { ...settings.toJSON(), lockedCategoriesCount }, "Category limit updated");
});
