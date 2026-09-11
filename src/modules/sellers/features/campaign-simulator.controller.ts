import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 15. AI MARKETING CAMPAIGN SIMULATOR
export const simulateCampaign = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { products, sellerOrders, totalRevenue, totalOrders } = await getSellerContext(userId);
  const { campaignName = "Flash Sale Event", discountPercent = 15, durationDays = 7, targetSegment = "all" } = req.body;

  const discount = Math.min(60, Math.max(1, Number(discountPercent)));
  const days = Math.min(30, Math.max(1, Number(durationDays)));

  // Calculate actual store AOV or reasonable benchmark
  const realAov = totalOrders > 0
    ? Math.round(totalRevenue / totalOrders)
    : products.length > 0
    ? Math.round(products.reduce((s, p) => s + (p.discountPrice || p.price || 0), 0) / products.length)
    : 1800;

  const estimatedReach = Math.round((5000 + products.length * 800) * (1 + discount * 0.04) * (days / 7));
  const conversionRate = Number(Math.min(7.5, Math.max(1.5, 2.0 + (discount / 10) * 0.8)).toFixed(1));
  const expectedOrders = Math.max(1, Math.round(estimatedReach * (conversionRate / 100)));
  
  const grossRevenue = Math.round(expectedOrders * realAov);
  const discountCost = Math.round(grossRevenue * (discount / 100));
  const netRevenue = grossRevenue - discountCost;

  sendSuccess(res, {
    campaignName,
    discountPercent: discount,
    durationDays: days,
    targetSegment,
    estimatedReach: estimatedReach.toLocaleString(),
    estimatedConversionRate: `${conversionRate}%`,
    expectedOrders: expectedOrders.toLocaleString(),
    grossRevenue: `৳${grossRevenue.toLocaleString()}`,
    discountCost: `৳${discountCost.toLocaleString()}`,
    netRevenue: `৳${netRevenue.toLocaleString()}`,
    recommendedDuration: `${days} Days (Optimal promotional window)`,
    riskScore: discount > 35 ? "High Discount Risk (Margin Compression)" : "Healthy Margin Range",
  });
});

