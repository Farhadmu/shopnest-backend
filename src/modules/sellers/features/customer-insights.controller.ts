import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";
import { getSellerStore } from "../seller-store.util";

// 23. CUSTOMER INSIGHTS & RETENTION TELEMETRY
export const getCustomerInsights = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const store = await getSellerStore(userId);

  const orders = await Order.find({ "items.storeId": store.id });
  const uniqueCustomerIds = new Set(orders.map((o) => o.userId));

  const totalCustomers = uniqueCustomerIds.size;
  const newCustomers = totalCustomers;
  const returningCustomers = 0;
  const repeatPurchaseRate = totalCustomers > 0 ? "0%" : "0%";
  const customerSatisfaction = `${store.rating || 5.0} / 5.0`;

  const topCustomerSegments = totalCustomers > 0
    ? [{ segment: "Verified Store Shoppers", count: totalCustomers, avgSpend: "৳0", ltv: "৳0" }]
    : [];

  const recentActivity = orders.slice(0, 5).map((o) => ({
    customer: `Customer (${o.userId.slice(-4)})`,
    action: `Placed Order #${o._id?.toString().slice(-6) || "ORD"}`,
    time: new Date(o.createdAt).toLocaleTimeString(),
    amount: `৳${(o.totalAmount || 0).toLocaleString()}`,
  }));

  sendSuccess(res, {
    overview: {
      totalCustomers,
      newCustomers,
      returningCustomers,
      repeatPurchaseRate,
      customerSatisfaction,
      averageLifetimeValue: totalCustomers > 0 ? `৳${Math.round(orders.reduce((s, o) => s + (o.totalAmount || 0), 0) / totalCustomers)}` : "৳0",
    },
    topCustomerSegments,
    recentActivity,
  });
});
