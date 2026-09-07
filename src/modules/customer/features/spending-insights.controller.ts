import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { Order } from "../../orders/order.model";

// 11. PERSONAL SHOPPING INSIGHTS & SPENDING ANALYTICS
export const getSpendingAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-user";

  const orders = await Order.find({ userId }).sort({ createdAt: -1 });

  // Calculate real metrics from orders
  const totalSpend = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

  // Real monthly aggregation from actual orders
  const monthMap: Record<string, { amount: number; orders: number }> = {};
  const categoryMap: Record<string, number> = {};
  const productMap: Record<string, { title: string; purchases: number; totalSpent: number; category: string }> = {};

  orders.forEach((o) => {
    const d = new Date(o.createdAt);
    const monthKey = d.toLocaleString("default", { month: "short" });
    if (!monthMap[monthKey]) monthMap[monthKey] = { amount: 0, orders: 0 };
    monthMap[monthKey].amount += o.totalAmount || 0;
    monthMap[monthKey].orders += 1;

    (o.items || []).forEach((item: any) => {
      const cat = item.category || "General";
      categoryMap[cat] = (categoryMap[cat] || 0) + (item.price * (item.quantity || 1));

      const pId = item.productId || item.title;
      if (!productMap[pId]) {
        productMap[pId] = {
          title: item.title,
          purchases: 0,
          totalSpent: 0,
          category: cat,
        };
      }
      productMap[pId].purchases += item.quantity || 1;
      productMap[pId].totalSpent += item.price * (item.quantity || 1);
    });
  });

  const monthlySpending = Object.entries(monthMap).map(([month, data]) => ({
    month,
    amount: data.amount,
    orders: data.orders,
  }));

  const categorySpending = Object.entries(categoryMap).map(([category, amount]) => ({
    category,
    amount,
    percentage: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0,
  }));

  const mostPurchasedProducts = Object.entries(productMap)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, 5);

  const topCategory = categorySpending.length > 0
    ? `${categorySpending[0].category} (${categorySpending[0].percentage}% of spend)`
    : "None yet";

  const streak = orderCount > 0 ? `${orderCount} order${orderCount > 1 ? "s" : ""} placed` : "No orders yet";

  sendSuccess(res, {
    overview: {
      totalSpend,
      monthlySpend: monthlySpending.length > 0 ? monthlySpending[monthlySpending.length - 1].amount : 0,
      orderFrequency: orderCount > 0 ? `${(orderCount / Math.max(1, monthlySpending.length)).toFixed(1)} orders / month` : "0 orders",
      orderCount,
      avgOrderValue,
      favoriteCategory: topCategory,
      shoppingStreak: streak,
    },
    monthlySpending,
    categorySpending,
    mostPurchasedProducts,
  });
});