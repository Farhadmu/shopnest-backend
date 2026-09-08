import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { ApiError } from "../../../utils/api-error";
import { Product } from "../../products/product.model";
import { StockAlert } from "../customer-extras.model";
import { PriceAlert } from "../customer-extras.model";

export const subscribePriceAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, targetPrice } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const alert = await PriceAlert.findOneAndUpdate(
    { userId, productId },
    {
      userId,
      productId,
      productTitle: product.title,
      targetPrice: Number(targetPrice) || (product.discountPrice ?? product.price),
      currentPrice: product.discountPrice ?? product.price,
      isTriggered: false,
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, alert, "Price drop alert subscribed successfully!");
});

export const getUserPriceAlerts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const alerts = await PriceAlert.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, alerts);
});

export const deletePriceAlert = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await PriceAlert.findOneAndDelete({ _id: id, userId: req.user!.id });
  sendSuccess(res, { success: true }, "Price alert removed");
});

export const subscribeStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, userEmail } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const alert = await StockAlert.findOneAndUpdate(
    { userId, productId },
    {
      userId,
      userEmail: userEmail || req.user!.email,
      productId,
      productTitle: product.title,
      isNotified: false,
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, alert, "You will be notified as soon as this item is back in stock!");
});

// ============================================================
// 7. BUDGET-BASED SHOPPING RECOMMENDATIONS (Feature 16)
// ============================================================
