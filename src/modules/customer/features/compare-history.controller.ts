import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { ComparisonHistory } from "../customer-extras.model";

export const getCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const history = await ComparisonHistory.find({ userId }).sort({ createdAt: -1 }).limit(10);
  sendSuccess(res, history);
});

export const saveCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { title, productIds, category } = req.body;

  const item = await ComparisonHistory.create({
    userId,
    title: title || "Product Comparison",
    productIds: productIds || [],
    category: category || "General",
  });

  sendSuccess(res, item, "Comparison saved to history");
});

export const clearCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await ComparisonHistory.deleteMany({ userId });
  sendSuccess(res, { success: true }, "Comparison history cleared");
});

// ============================================================
// 12. SMART WISHLIST GROUPS (Feature 25)
// ============================================================
