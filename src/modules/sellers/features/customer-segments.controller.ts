import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext } from "../seller-store.util";

// 16. CUSTOMER SEGMENT BUILDER
export const getCustomerSegments = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const { sellerOrders, uniqueBuyerIds } = await getSellerContext(userId);

  const totalCustomersTracked = uniqueBuyerIds.length;

  if (totalCustomersTracked === 0) {
    return sendSuccess(res, {
      totalCustomersTracked: 0,
      segments: [],
    });
  }

  // Aggregate stats per customer
  const now = Date.now();
  const customerMap: Record<string, { count: number; totalSpend: number; lastOrderDate: Date }> = {};

  sellerOrders.forEach((order) => {
    const bId = order.userId;
    if (!bId) return;
    if (!customerMap[bId]) {
      customerMap[bId] = { count: 0, totalSpend: 0, lastOrderDate: new Date(order.createdAt) };
    }
    customerMap[bId].count += 1;
    customerMap[bId].totalSpend += order.sellerSubtotal;
    if (new Date(order.createdAt) > customerMap[bId].lastOrderDate) {
      customerMap[bId].lastOrderDate = new Date(order.createdAt);
    }
  });

  const vipBuyers: string[] = [];
  const repeatBuyers: string[] = [];
  const firstTimeBuyers: string[] = [];
  const atRiskBuyers: string[] = [];

  Object.entries(customerMap).forEach(([buyerId, stats]) => {
    const daysSince = Math.round((now - stats.lastOrderDate.getTime()) / (24 * 3600 * 1000));
    if (stats.count >= 3 || stats.totalSpend >= 10000) {
      vipBuyers.push(buyerId);
    } else if (stats.count >= 2) {
      repeatBuyers.push(buyerId);
    } else if (daysSince <= 30) {
      firstTimeBuyers.push(buyerId);
    } else {
      atRiskBuyers.push(buyerId);
    }
  });

  const buildSegment = (name: string, ids: string[], defaultAction: string) => {
    const count = ids.length;
    if (count === 0) return null;
    const percentage = Math.round((count / totalCustomersTracked) * 100);
    const totalSegmentSpend = ids.reduce((sum, id) => sum + (customerMap[id]?.totalSpend || 0), 0);
    const totalSegmentOrders = ids.reduce((sum, id) => sum + (customerMap[id]?.count || 0), 0);
    const aov = Math.round(totalSegmentSpend / Math.max(1, totalSegmentOrders));
    const repeatFreq = (totalSegmentOrders / count).toFixed(1);

    return {
      name,
      percentage,
      customerCount: count,
      avgOrderValue: `৳${aov.toLocaleString()}`,
      repeatFrequency: `${repeatFreq}x`,
      recommendedAction: defaultAction,
    };
  };

  const segments = [
    buildSegment("VIP Champions", vipBuyers, "Offer exclusive early access & loyalty perks."),
    buildSegment("Repeat Buyers", repeatBuyers, "Send personalized re-order recommendations."),
    buildSegment("New First-Timers", firstTimeBuyers, "Deliver fast dispatch to turn into repeat buyers."),
    buildSegment("At-Risk / Inactive", atRiskBuyers, "Send a special win-back discount voucher."),
  ].filter(Boolean);

  sendSuccess(res, {
    totalCustomersTracked,
    segments,
  });
});

