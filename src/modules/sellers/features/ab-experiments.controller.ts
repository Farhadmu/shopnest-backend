import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { AbExperiment } from "../seller-intelligence.model";
import { getSellerStore } from "../seller-store.util";

// 20. SELLER A/B TESTING
export const getAbExperiments = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const experiments = await AbExperiment.find({ storeId: store.id });

  sendSuccess(res, experiments);
});

export const createAbExperiment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);
  const { productId, productTitle, testType, variantAValue, variantBValue } = req.body;

  const experiment = await AbExperiment.create({
    sellerId: userId,
    storeId: store.id,
    productId,
    productTitle,
    testType,
    variantA: { name: "A", value: variantAValue, views: 0, clicks: 0, cartAdds: 0, orders: 0, revenue: 0, conversionRate: 0 },
    variantB: { name: "B", value: variantBValue, views: 0, clicks: 0, cartAdds: 0, orders: 0, revenue: 0, conversionRate: 0 },
    status: "active",
    confidenceScore: 50,
  });

  sendSuccess(res, experiment.toJSON(), "A/B Experiment launched", 201);
});
