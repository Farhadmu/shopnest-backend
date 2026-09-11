import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";

// 14. SELLER GROWTH SIMULATOR
export const simulateGrowthScenario = asyncHandler(async (req: Request, res: Response) => {
  const { productId, currentPrice = 2500, newPrice = 2300, adSpend = 5000, inventoryExpansion = 20 } = req.body;

  let basePrice = Number(currentPrice);
  let targetPrice = Number(newPrice);
  let productTitle = "Selected Catalog Item";

  if (productId) {
    const product = await Product.findById(productId);
    if (product) {
      basePrice = basePrice || product.price;
      productTitle = product.title;
    }
  }

  if (basePrice <= 0) basePrice = 1000;
  if (targetPrice <= 0) targetPrice = basePrice;

  const priceDeltaPercent = ((targetPrice - basePrice) / basePrice) * 100;
  // Standard e-commerce price elasticity (-1.4 to -1.8)
  const elasticity = -1.6;
  const adEffect = adSpend > 0 ? (Math.log10(adSpend + 100) - 2) * 8 : 0;
  
  const salesVolumeDeltaPercent = Math.round(priceDeltaPercent * elasticity + adEffect);
  const revenueDeltaPercent = Math.round(
    ((1 + salesVolumeDeltaPercent / 100) * (1 + priceDeltaPercent / 100) - 1) * 100
  );
  const grossMarginImpact = Math.round(priceDeltaPercent * 0.85 - (adSpend > 0 ? 3 : 0));
  const estimatedExtraOrders = Math.max(0, Math.round(Math.abs(salesVolumeDeltaPercent) * 1.5 + (adSpend / 1000) * 2));

  sendSuccess(res, {
    scenario: {
      productId,
      productTitle,
      currentPrice: basePrice,
      newPrice: targetPrice,
      adSpend: Number(adSpend),
      inventoryExpansion: Number(inventoryExpansion),
    },
    projectedImpact: {
      salesVolumeChange: `${salesVolumeDeltaPercent >= 0 ? "+" : ""}${salesVolumeDeltaPercent}%`,
      revenueChange: `${revenueDeltaPercent >= 0 ? "+" : ""}${revenueDeltaPercent}%`,
      grossMarginImpact: `${grossMarginImpact >= 0 ? "+" : ""}${grossMarginImpact}%`,
      estimatedExtraOrders,
    },
    strategicInsight:
      revenueDeltaPercent > 0
        ? `Adjusting price to ৳${targetPrice.toLocaleString()} with ৳${Number(adSpend).toLocaleString()} ad spend is projected to increase monthly revenue by ${revenueDeltaPercent}%.`
        : `Proposed price reduction without sufficient marketing lift may compress net profit margin. Consider bundling or smaller discount tiers.`,
  });
});

