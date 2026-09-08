import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { getSellerStore } from "../seller-store.util";

// 18. PRODUCT PROFITABILITY ANALYZER
export const getProfitabilityAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const orders = await Order.find({ "items.storeId": store.id });
  const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const cogs = Math.round(revenue * 0.65); // Cost of Goods Sold ~65%
  const deliveryCost = Math.round(revenue * 0.05);
  const marketingCost = Math.round(revenue * 0.04);
  const returnLosses = 0;

  const grossProfit = revenue - cogs;
  const estimatedNetProfit = grossProfit - deliveryCost - marketingCost;
  const netMarginPercent = revenue > 0 ? Math.round((estimatedNetProfit / revenue) * 100) : 0;

  const products = await Product.find({ $or: [{ storeId: store.id }, { sellerId: userId }], isDeleted: false });

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
    topProfitableProducts: products.map((p) => ({
      title: p.title,
      revenue: (p.sold || 0) * (p.discountPrice || p.price),
      marginPercent: 35,
      netProfit: Math.round(((p.sold || 0) * (p.discountPrice || p.price)) * 0.35),
    })),
  });
});
