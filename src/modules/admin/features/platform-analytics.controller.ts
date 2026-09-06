import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Store } from "../../sellers/store.model";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";

export const getPlatformAnalytics = asyncHandler(async (req: Request, res: Response) => {
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

  const db = mongoose.connection.db;
  const totalUsers = (await db?.collection("user").countDocuments()) || 0;
  const totalSellers = (await db?.collection("user").countDocuments({ role: "seller" })) || 0;

  const currentOrders = await Order.find({ createdAt: { $gte: startDate } });
  const prevOrders = await Order.find({ createdAt: { $gte: prevStartDate, $lt: startDate } });
  const allOrders = await Order.find({});

  const validStatuses = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];
  const currentValidOrders = currentOrders.filter((o) => validStatuses.includes(o.status));
  const prevValidOrders = prevOrders.filter((o) => validStatuses.includes(o.status));

  const totalRevenue = currentValidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const prevTotalRevenue = prevValidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const totalOrders = currentValidOrders.length;

  const revenueGrowth = prevTotalRevenue > 0
    ? Math.round(((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 1000) / 10
    : totalRevenue > 0 ? 100 : 0;

  const products = await Product.find({ isDeleted: false });
  const productCategoryMap = new Map<string, string>();
  products.forEach((p) => productCategoryMap.set(p._id?.toString() || "", p.category || "General"));

  const timelineMap: Record<string, { revenue: number; orders: number }> = {};
  currentValidOrders.forEach((o) => {
    const d = new Date(o.createdAt);
    let label: string;
    if (range === "7d") {
      label = d.toLocaleDateString("default", { weekday: "short" });
    } else if (range === "30d") {
      label = d.toLocaleDateString("default", { month: "short", day: "numeric" });
    } else {
      label = d.toLocaleDateString("default", { month: "short" });
    }
    if (!timelineMap[label]) timelineMap[label] = { revenue: 0, orders: 0 };
    timelineMap[label].revenue += o.totalAmount || 0;
    timelineMap[label].orders += 1;
  });

  const timeline = Object.entries(timelineMap).map(([label, data]) => ({
    label,
    revenue: data.revenue,
    orders: data.orders,
    users: Math.max(1, Math.round(data.orders * 1.2)),
    sellers: Math.max(1, totalSellers),
  }));

  const categoryRevenueMap: Record<string, number> = {};
  const categoryOrderMap: Record<string, Set<string>> = {};

  currentValidOrders.forEach((order) => {
    const orderId = order._id?.toString() || "";
    order.items?.forEach((item: any) => {
      const productId = item.productId?.toString() || "";
      const category = productCategoryMap.get(productId) || "General";
      const itemRevenue = (item.price || 0) * (item.quantity || 1);

      categoryRevenueMap[category] = (categoryRevenueMap[category] || 0) + itemRevenue;
      if (!categoryOrderMap[category]) categoryOrderMap[category] = new Set();
      categoryOrderMap[category].add(orderId);
    });
  });

  const totalCategoryRevenue = Object.values(categoryRevenueMap).reduce((s, v) => s + v, 0) || 1;
  const categoryPerformance = Object.entries(categoryRevenueMap)
    .map(([category, revenue]) => ({
      category,
      revenue,
      share: Math.round((revenue / totalCategoryRevenue) * 1000) / 10,
      orders: categoryOrderMap[category]?.size || 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const sellerStats: Record<string, {
    gmv: number;
    orders: Set<string>;
    returnedOrders: Set<string>;
    rating: number;
    storeName: string;
    productCount: number;
  }> = {};

  currentValidOrders.forEach((order) => {
    const orderId = order._id?.toString() || "";
    order.items?.forEach((item: any) => {
      const storeId = item.storeId?.toString() || "";
      if (!sellerStats[storeId]) {
        sellerStats[storeId] = { gmv: 0, orders: new Set(), returnedOrders: new Set(), rating: 0, storeName: "", productCount: 0 };
      }
      sellerStats[storeId].gmv += (item.price || 0) * (item.quantity || 1);
      sellerStats[storeId].orders.add(orderId);
    });
  });

  allOrders.forEach((order) => {
    if (order.status === "returned" || order.status === "refunded") {
      const orderId = order._id?.toString() || "";
      order.items?.forEach((item: any) => {
        const storeId = item.storeId?.toString() || "";
        if (sellerStats[storeId]) {
          sellerStats[storeId].returnedOrders.add(orderId);
        }
      });
    }
  });

  const stores = await Store.find({});
  stores.forEach((store) => {
    const storeId = store._id?.toString() || "";
    if (sellerStats[storeId]) {
      sellerStats[storeId].rating = store.rating || 0;
      sellerStats[storeId].storeName = store.storeName || "Unknown Store";
    }
  });

  products.forEach((p) => {
    const storeId = p.storeId?.toString() || "";
    if (sellerStats[storeId]) {
      sellerStats[storeId].productCount += 1;
    }
  });

  const topSellersRanking = Object.entries(sellerStats)
    .map(([storeId, stats]) => ({
      rank: 0,
      storeId,
      name: stats.storeName || "Unknown Store",
      gmv: stats.gmv,
      gmvFormatted: `৳${stats.gmv.toLocaleString()}`,
      orders: stats.orders.size,
      rating: stats.rating,
      returnRate: stats.orders.size > 0 ? Math.round((stats.returnedOrders.size / stats.orders.size) * 1000) / 10 : 0,
      products: stats.productCount,
    }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 10)
    .map((s, idx) => ({ ...s, rank: idx + 1 }));

  sendSuccess(res, {
    range,
    kpis: {
      totalRevenue,
      revenueGrowth,
      totalUsers,
      userGrowth: totalUsers > 0 ? `+${totalUsers}` : "0",
      totalSellers,
      sellerGrowth: totalSellers > 0 ? `+${totalSellers}` : "0",
      totalOrders,
      orderGrowth: totalOrders > 0 ? `+${totalOrders}` : "0",
    },
    timeline,
    categoryPerformance,
    topSellersRanking,
  });
});

// 37. RULE-BASED FRAUD & RISK DETECTION MATRIX