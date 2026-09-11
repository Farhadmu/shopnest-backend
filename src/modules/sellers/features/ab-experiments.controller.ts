import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { AbExperiment } from "../seller-intelligence.model";
import { Product } from "../../products/product.model";
import { getSellerContext } from "../seller-store.util";

// 20. SELLER A/B TESTING
export const getAbExperiments = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { store, products } = await getSellerContext(userId);
  const storeIdStr = store._id?.toString() || store.id;

  const experiments = await AbExperiment.find({
    $or: [{ storeId: storeIdStr }, { sellerId: userId }],
  }).sort({ createdAt: -1 });

  // Compute dynamic stats & statistical lift for active experiments
  const enrichedExperiments = experiments.map((exp) => {
    const json = exp.toJSON();
    const vA = json.variantA || { views: 0, orders: 0, conversionRate: 0 };
    const vB = json.variantB || { views: 0, orders: 0, conversionRate: 0 };

    const convA = vA.views > 0 ? Number(((vA.orders / vA.views) * 100).toFixed(1)) : 0;
    const convB = vB.views > 0 ? Number(((vB.orders / vB.views) * 100).toFixed(1)) : 0;

    let winner: "variantA" | "variantB" | "inconclusive" = "inconclusive";
    let liftPercent = 0;

    if (vA.views >= 20 && vB.views >= 20) {
      if (convB > convA) {
        winner = "variantB";
        liftPercent = convA > 0 ? Math.round(((convB - convA) / convA) * 100) : Math.round(convB * 10);
      } else if (convA > convB) {
        winner = "variantA";
        liftPercent = convB > 0 ? Math.round(((convA - convB) / convB) * 100) : Math.round(convA * 10);
      }
    }

    return {
      ...json,
      variantA: { ...vA, conversionRate: convA },
      variantB: { ...vB, conversionRate: convB },
      winner,
      liftPercent,
      confidenceScore: vA.views + vB.views >= 50 ? 95 : vA.views + vB.views >= 20 ? 80 : 50,
    };
  });

  sendSuccess(res, enrichedExperiments);
});

export const createAbExperiment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { store, products } = await getSellerContext(userId);
  const { productId, productTitle, testType = "title", variantAValue, variantBValue } = req.body;

  let resolvedTitle = productTitle || "Selected Product";
  if (productId) {
    const prod = products.find((p) => (p._id?.toString() || p.id) === productId) || (await Product.findById(productId));
    if (prod) {
      resolvedTitle = prod.title;
    }
  }

  const storeIdStr = store._id?.toString() || store.id;

  const experiment = await AbExperiment.create({
    sellerId: userId,
    storeId: storeIdStr,
    productId: productId || "catalog-item",
    productTitle: resolvedTitle,
    testType,
    variantA: {
      name: "A (Original)",
      value: variantAValue,
      views: 0,
      clicks: 0,
      cartAdds: 0,
      orders: 0,
      revenue: 0,
      conversionRate: 0,
    },
    variantB: {
      name: "B (AI Variation)",
      value: variantBValue,
      views: 0,
      clicks: 0,
      cartAdds: 0,
      orders: 0,
      revenue: 0,
      conversionRate: 0,
    },
    status: "active",
    confidenceScore: 50,
  });

  sendSuccess(res, experiment.toJSON(), "A/B Experiment launched", 201);
});

