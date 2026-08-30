import { Request, Response } from "express";
import { ProfitCalculator } from "./profit-calculator.model";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";

export const calculateProfit = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const { productId, sellingPrice, productCost, deliveryCost, platformFee, discount = 0 } = req.body;

  const estimatedProfit = Math.round((sellingPrice - productCost - deliveryCost - platformFee - discount) * 100) / 100;
  const profitMargin = sellingPrice > 0 ? Math.round((estimatedProfit / sellingPrice) * 10000) / 100 : 0;

  const record = await ProfitCalculator.findOneAndUpdate(
    { sellerId, productId },
    {
      sellerId,
      productId,
      sellingPrice,
      productCost,
      deliveryCost,
      platformFee,
      discount,
      estimatedProfit,
      profitMargin,
      calculatedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  sendSuccess(res, record, "Profit calculated");
});

export const getProfitHistory = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.user!.id;
  const history = await ProfitCalculator.find({ sellerId }).sort({ calculatedAt: -1 }).limit(100);
  sendSuccess(res, history);
});
