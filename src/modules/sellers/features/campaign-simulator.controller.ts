import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";

// 15. AI MARKETING CAMPAIGN SIMULATOR
export const simulateCampaign = asyncHandler(async (req: Request, res: Response) => {
  const { campaignName = "Mega Flash Sale", discountPercent = 15, durationDays = 7, targetSegment = "all" } = req.body;

  const estimatedReach = Math.round(18000 + Number(discountPercent) * 1200);
  const conversionRate = Math.min(8.5, Math.max(2.1, 2.8 + (Number(discountPercent) / 10) * 1.4));
  const expectedOrders = Math.round((estimatedReach * (conversionRate / 100)));
  const avgOrderValue = 2100;
  const grossRevenue = Math.round(expectedOrders * avgOrderValue);
  const discountCost = Math.round(grossRevenue * (Number(discountPercent) / 100));
  const netRevenue = grossRevenue - discountCost;

  sendSuccess(res, {
    campaignName,
    discountPercent,
    durationDays,
    targetSegment,
    estimatedReach: estimatedReach.toLocaleString(),
    estimatedConversionRate: `${conversionRate.toFixed(1)}%`,
    expectedOrders: expectedOrders.toLocaleString(),
    grossRevenue: `৳${grossRevenue.toLocaleString()}`,
    discountCost: `৳${discountCost.toLocaleString()}`,
    netRevenue: `৳${netRevenue.toLocaleString()}`,
    recommendedDuration: `${durationDays} Days (Optimal urgency window)`,
    riskScore: discountPercent > 30 ? "High Discount Risk" : "Low / Healthy Margin",
  });
});
