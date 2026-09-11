import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 23. CUSTOMER INSIGHTS & RETENTION TELEMETRY
export const getCustomerInsights = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { store, sellerOrders, totalRevenue } = await getSellerContext(userId);

  // Group orders by customer userId
  const customerMap: Record<string, { orderCount: number; totalSpend: number; lastOrder: Date }> = {};

  sellerOrders.forEach((o: any) => {
    const cId = o.userId || "guest";
    if (!customerMap[cId]) {
      customerMap[cId] = { orderCount: 0, totalSpend: 0, lastOrder: new Date(o.createdAt) };
    }
    customerMap[cId].orderCount += 1;
    customerMap[cId].totalSpend += o.totalAmount || 0;
    if (new Date(o.createdAt) > customerMap[cId].lastOrder) {
      customerMap[cId].lastOrder = new Date(o.createdAt);
    }
  });

  const customerEntries = Object.entries(customerMap);
  const totalCustomers = customerEntries.length;
  const returningCustomers = customerEntries.filter(([_, c]) => c.orderCount > 1).length;
  const newCustomers = totalCustomers - returningCustomers;
  const repeatPurchaseRate = totalCustomers > 0 ? `${Math.round((returningCustomers / totalCustomers) * 100)}%` : "0%";
  const customerSatisfaction = `${(store.rating || 5.0).toFixed(1)} / 5.0`;
  const avgLtv = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;

  // Build real buyer segments from customer spend distribution
  const topCustomerSegments: Array<{ segment: string; count: number; avgSpend: string; ltv: string }> = [];

  if (totalCustomers > 0) {
    const vipBuyers = customerEntries.filter(([_, c]) => c.totalSpend >= avgLtv * 1.5 || c.orderCount >= 3);
    const standardRepeat = customerEntries.filter(([_, c]) => c.orderCount > 1 && !vipBuyers.some(([id]) => id === _));
    const firstTimeBuyers = customerEntries.filter(([_, c]) => c.orderCount === 1 && !vipBuyers.some(([id]) => id === _));

    if (vipBuyers.length > 0) {
      const vipSpend = Math.round(vipBuyers.reduce((s, [_, c]) => s + c.totalSpend, 0) / vipBuyers.length);
      topCustomerSegments.push({
        segment: "VIP & Frequent Buyers",
        count: vipBuyers.length,
        avgSpend: `৳${vipSpend.toLocaleString()}`,
        ltv: `৳${Math.round(vipSpend * 1.8).toLocaleString()}`,
      });
    }

    if (standardRepeat.length > 0) {
      const repeatSpend = Math.round(standardRepeat.reduce((s, [_, c]) => s + c.totalSpend, 0) / standardRepeat.length);
      topCustomerSegments.push({
        segment: "Repeat Shoppers",
        count: standardRepeat.length,
        avgSpend: `৳${repeatSpend.toLocaleString()}`,
        ltv: `৳${Math.round(repeatSpend * 1.4).toLocaleString()}`,
      });
    }

    if (firstTimeBuyers.length > 0) {
      const firstSpend = Math.round(firstTimeBuyers.reduce((s, [_, c]) => s + c.totalSpend, 0) / firstTimeBuyers.length);
      topCustomerSegments.push({
        segment: "First-Time Customers",
        count: firstTimeBuyers.length,
        avgSpend: `৳${firstSpend.toLocaleString()}`,
        ltv: `৳${firstSpend.toLocaleString()}`,
      });
    }
  }

  const recentActivity = sellerOrders.slice(0, 5).map((o: any) => ({
    customer: `Buyer (${(o.userId || "user").slice(-4)})`,
    action: `Ordered #${o._id?.toString().slice(-6) || "ORD"} • ${(o.items || []).length} item(s)`,
    time: new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    amount: `৳${(o.totalAmount || 0).toLocaleString()}`,
  }));

  sendSuccess(res, {
    overview: {
      totalCustomers,
      newCustomers,
      returningCustomers,
      repeatPurchaseRate,
      customerSatisfaction,
      averageLifetimeValue: `৳${avgLtv.toLocaleString()}`,
    },
    topCustomerSegments,
    recentActivity,
  });
});

