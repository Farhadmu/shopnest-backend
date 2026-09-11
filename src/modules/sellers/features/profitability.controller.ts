import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 18. PRODUCT PROFITABILITY ANALYZER
export const getProfitabilityAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { products, sellerOrders, totalRevenue, totalOrders } = await getSellerContext(userId);

  const revenue = totalRevenue;
  const cogs = revenue > 0 ? Math.round(revenue * 0.60) : 0; // Estimated 60% standard COGS
  const deliveryCost = revenue > 0 ? Math.round(revenue * 0.04) : 0;
  const marketingCost = revenue > 0 ? Math.round(revenue * 0.03) : 0;
  const returnLosses = 0;

  const grossProfit = revenue - cogs;
  const estimatedNetProfit = revenue > 0 ? grossProfit - deliveryCost - marketingCost : 0;
  const netMarginPercent = revenue > 0 ? Math.round((estimatedNetProfit / revenue) * 100) : 0;

  // Build top profitable products from real product sales
  const topProfitableProducts = products.map((p) => {
    const soldUnits = p.sold || 0;
    const unitPrice = p.discountPrice || p.price || 0;
    const itemRevenue = soldUnits * unitPrice;
    const marginPercent = 35; // 35% estimated gross margin per unit
    const netProfit = Math.round(itemRevenue * (marginPercent / 100));

    return {
      id: p._id?.toString() || p.id,
      title: p.title,
      price: unitPrice,
      sold: soldUnits,
      stock: p.stock || 0,
      image: p.images?.[0] || "",
      revenue: itemRevenue,
      marginPercent,
      netProfit,
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  sendSuccess(res, {
    summary: {
      revenue,
      cogs,
      deliveryCost,
      marketingCost,
      returnLosses,
      grossProfit,
      estimatedNetProfit,
      netMarginPercent: `${netMarginPercent}%`,
    },
    topProfitableProducts,
  });
});

