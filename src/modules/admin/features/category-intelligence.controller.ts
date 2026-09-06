import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";

export const getCategoryIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const { range = "30d" } = req.query as { range?: string };

  const now = new Date();
  const rangeMs = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "3m": 90 * 24 * 60 * 60 * 1000,
    "6m": 180 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
  }[range] || 30 * 24 * 60 * 60 * 1000;

  const startDate = new Date(now.getTime() - rangeMs);
  const prevStartDate = new Date(startDate.getTime() - rangeMs);

  const products = await Product.find({ isDeleted: false });
  const currentOrders = await Order.find({ createdAt: { $gte: startDate } });
  const prevOrders = await Order.find({ createdAt: { $gte: prevStartDate, $lt: startDate } });

  const productCategoryMap = new Map<string, string>();
  products.forEach((p) => {
    productCategoryMap.set(p._id?.toString() || "", p.category || "General");
  });

  const categoryStats: Record<string, {
    revenue: number;
    prevRevenue: number;
    orders: Set<string>;
    prevOrders: Set<string>;
    unitsSold: number;
    sellers: Set<string>;
    ratings: number[];
    ratingCount: number;
  }> = {};

  const validStatuses = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];

  currentOrders.forEach((order) => {
    if (!validStatuses.includes(order.status)) return;
    const orderId = order._id?.toString() || "";

    order.items?.forEach((item: any) => {
      const productId = item.productId?.toString() || "";
      const category = productCategoryMap.get(productId) || "General";
      const itemRevenue = (item.price || 0) * (item.quantity || 1);

      if (!categoryStats[category]) {
        categoryStats[category] = {
          revenue: 0, prevRevenue: 0, orders: new Set(), prevOrders: new Set(),
          unitsSold: 0, sellers: new Set(), ratings: [], ratingCount: 0,
        };
      }

      categoryStats[category].revenue += itemRevenue;
      categoryStats[category].orders.add(orderId);
      categoryStats[category].unitsSold += item.quantity || 1;
      if (item.sellerId) categoryStats[category].sellers.add(item.sellerId);
    });
  });

  prevOrders.forEach((order) => {
    if (!validStatuses.includes(order.status)) return;
    const orderId = order._id?.toString() || "";

    order.items?.forEach((item: any) => {
      const productId = item.productId?.toString() || "";
      const category = productCategoryMap.get(productId) || "General";
      const itemRevenue = (item.price || 0) * (item.quantity || 1);

      if (!categoryStats[category]) {
        categoryStats[category] = {
          revenue: 0, prevRevenue: 0, orders: new Set(), prevOrders: new Set(),
          unitsSold: 0, sellers: new Set(), ratings: [], ratingCount: 0,
        };
      }

      categoryStats[category].prevRevenue += itemRevenue;
      categoryStats[category].prevOrders.add(orderId);
    });
  });

  products.forEach((p) => {
    const category = p.category || "General";
    if (!categoryStats[category]) {
      categoryStats[category] = {
        revenue: 0, prevRevenue: 0, orders: new Set(), prevOrders: new Set(),
        unitsSold: 0, sellers: new Set(), ratings: [], ratingCount: 0,
      };
    }
    if (p.sellerId) categoryStats[category].sellers.add(p.sellerId);
    if (p.ratingAvg > 0) {
      categoryStats[category].ratings.push(p.ratingAvg);
      categoryStats[category].ratingCount += p.ratingCount || 1;
    }
  });

  const totalRevenue = Object.values(categoryStats).reduce((sum, s) => sum + s.revenue, 0);

  const categories = Object.entries(categoryStats).map(([name, stats]) => {
    const avgOrderValue = stats.orders.size > 0 ? Math.round(stats.revenue / stats.orders.size) : 0;
    const revenueShare = totalRevenue > 0 ? Math.round((stats.revenue / totalRevenue) * 1000) / 10 : 0;
    const growthRate = stats.prevRevenue > 0
      ? Math.round(((stats.revenue - stats.prevRevenue) / stats.prevRevenue) * 1000) / 10
      : stats.revenue > 0 ? 100 : 0;
    const avgRating = stats.ratings.length > 0
      ? Math.round((stats.ratings.reduce((a, b) => a + b, 0) / stats.ratings.length) * 10) / 10
      : 0;

    return {
      name,
      products: products.filter((p) => (p.category || "General") === name).length,
      activeSellers: stats.sellers.size,
      orders: stats.orders.size,
      unitsSold: stats.unitsSold,
      revenue: stats.revenue,
      avgOrderValue,
      revenueShare,
      growthRate,
      avgRating,
      ratingCount: stats.ratingCount,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  sendSuccess(res, {
    categories,
    topPerformer: categories[0]?.name || "N/A",
    fastestExpandingCatalog: `${categories.length} Categories`,
    totalRevenue,
  });
});

// 35. PLATFORM BOTTLENECK & API TELEMETRY MONITOR