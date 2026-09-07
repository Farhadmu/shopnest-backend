import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";

// 14. SELLER GROWTH SIMULATOR
export const simulateGrowthScenario = asyncHandler(async (req: Request, res: Response) => {
  const { currentPrice = 2500, newPrice = 2300, adSpend = 5000, inventoryExpansion = 20 } = req.body;

  const priceDeltaPercent = ((newPrice - currentPrice) / currentPrice) * 100;
  const elasticity = -1.6; // Price elasticity of demand in e-commerce
  const salesVolumeDeltaPercent = Math.round(priceDeltaPercent * elasticity + (adSpend / 1000) * 1.8);
  const revenueDeltaPercent = Math.round(salesVolumeDeltaPercent + priceDeltaPercent);
  const marginDeltaPercent = Math.round(priceDeltaPercent * 0.7 - 2);

  sendSuccess(res, {
    scenario: { currentPrice, newPrice, adSpend, inventoryExpansion },
    projectedImpact: {
      salesVolumeChange: `${salesVolumeDeltaPercent > 0 ? "+" : ""}${salesVolumeDeltaPercent}%`,
      revenueChange: `${revenueDeltaPercent > 0 ? "+" : ""}${revenueDeltaPercent}%`,
      grossMarginImpact: `${marginDeltaPercent > 0 ? "+" : ""}${marginDeltaPercent}%`,
      estimatedExtraOrders: Math.max(15, Math.round(salesVolumeDeltaPercent * 3.2)),
    },
    strategicInsight:
      revenueDeltaPercent > 0
        ? `✅ Price adjustment to ৳${newPrice.toLocaleString()} accompanied by ৳${adSpend.toLocaleString()} ad spend is projected to deliver positive net revenue growth.`
        : `⚠️ Proposed price reduction may erode gross margin without sufficient unit velocity lift.`,
  });
});
