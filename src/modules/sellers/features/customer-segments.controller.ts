import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";
import { getSellerStore } from "../seller-store.util";

// 16. CUSTOMER SEGMENT BUILDER
export const getCustomerSegments = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const orders = await Order.find({ "items.storeId": store.id });
  const uniqueBuyers = Array.from(new Set(orders.map((o) => o.userId)));
  const totalCustomersTracked = uniqueBuyers.length;

  sendSuccess(res, {
    totalCustomersTracked,
    segments: totalCustomersTracked === 0 ? [] : [
      { name: "Active Store Buyers", percentage: 100, customerCount: totalCustomersTracked, avgOrderValue: `৳${Math.round(orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0) / totalCustomersTracked).toLocaleString()}`, repeatFrequency: `${(orders.length / totalCustomersTracked).toFixed(1)}x`, recommendedAction: "Deliver exceptional fulfillment to encourage repeat purchases." },
    ],
  });
});
