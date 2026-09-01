import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Order } from "../orders/order.model";
import { Product } from "../products/product.model";
import { Store } from "../sellers/store.model";
import { SpendingBudget } from "./spending-budget.model";

const VALID_SPENDING_STATUSES = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];
const EXCLUDED_STATUSES = ["cancelled", "returned", "refunded"];

interface DateRangeFilter {
  startDate?: Date;
  endDate?: Date;
}

function buildDateFilter(range: string): DateRangeFilter {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  switch (range) {
    case "this_week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now };
    }
    case "this_month": {
      const start = new Date(currentYear, currentMonth, 1);
      return { startDate: start, endDate: now };
    }
    case "last_month": {
      const start = new Date(currentYear, currentMonth - 1, 1);
      const end = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }
    case "last_3_months": {
      const start = new Date(currentYear, currentMonth - 3, 1);
      return { startDate: start, endDate: now };
    }
    case "last_6_months": {
      const start = new Date(currentYear, currentMonth - 6, 1);
      return { startDate: start, endDate: now };
    }
    case "last_12_months": {
      const start = new Date(currentYear, currentMonth - 12, 1);
      return { startDate: start, endDate: now };
    }
    case "this_year": {
      const start = new Date(currentYear, 0, 1);
      return { startDate: start, endDate: now };
    }
    default:
      return {};
  }
}

export const getComprehensiveSpendingAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const range = (req.query.range as string) || "all";
  const dateFilter = buildDateFilter(range);

  const matchStage: Record<string, unknown> = { userId };
  if (dateFilter.startDate || dateFilter.endDate) {
    matchStage.createdAt = {};
    if (dateFilter.startDate) (matchStage.createdAt as Record<string, Date>).$gte = dateFilter.startDate;
    if (dateFilter.endDate) (matchStage.createdAt as Record<string, Date>).$lte = dateFilter.endDate;
  }

  const allOrders = await Order.find(matchStage).sort({ createdAt: -1 });

  const validOrders = allOrders.filter((o) => VALID_SPENDING_STATUSES.includes(o.status));
  const cancelledOrders = allOrders.filter((o) => o.status === "cancelled");
  const returnedOrders = allOrders.filter((o) => o.status === "returned" || o.status === "refunded");

  const totalSpent = validOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = allOrders.length;
  const completedOrders = validOrders.length;
  const averageOrderValue = completedOrders > 0 ? Math.round(totalSpent / completedOrders) : 0;

  const productIds = [...new Set(validOrders.flatMap((o) => o.items.map((i) => i.productId)))];
  const products = await Product.find({ _id: { $in: productIds } }).select("category price discountPrice storeId sellerId title");
  const productMap = new Map(products.map((p) => [p.id, p]));

  const storeIds = [...new Set(validOrders.flatMap((o) => o.items.map((i) => i.storeId)))];
  const stores = await Store.find({ _id: { $in: storeIds } }).select("storeName");
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  const monthMap: Record<string, { amount: number; orders: number; year: number; month: number }> = {};
  const weekDayMap: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  const categoryMap: Record<string, number> = {};
  const sellerMap: Record<string, { name: string; amount: number; orders: Set<string> }> = {};
  let totalDiscount = 0;
  let totalSubtotal = 0;
  let couponSavings = 0;

  validOrders.forEach((order) => {
    const date = new Date(order.createdAt);
    const monthKey = date.toLocaleString("default", { month: "short" });
    const year = date.getFullYear();
    const month = date.getMonth();
    const weekDay = date.toLocaleString("default", { weekday: "short" });

    const mapKey = `${year}-${monthKey}`;
    if (!monthMap[mapKey]) {
      monthMap[mapKey] = { amount: 0, orders: 0, year, month };
    }
    monthMap[mapKey].amount += order.totalAmount;
    monthMap[mapKey].orders += 1;

    weekDayMap[weekDay] += order.totalAmount;

    totalSubtotal += order.subtotal;
    couponSavings += order.discount || 0;

    order.items.forEach((item) => {
      const product = productMap.get(item.productId);
      const category = product?.category || "General";
      const itemTotal = item.price * item.quantity;
      categoryMap[category] = (categoryMap[category] || 0) + itemTotal;

      const store = storeMap.get(item.storeId);
      const sellerName = store?.storeName || "Unknown Seller";
      if (!sellerMap[item.sellerId]) {
        sellerMap[item.sellerId] = { name: sellerName, amount: 0, orders: new Set() };
      }
      sellerMap[item.sellerId].amount += itemTotal;
      sellerMap[item.sellerId].orders.add(order.id);

      if (product?.price && product.discountPrice) {
        totalDiscount += (product.price - product.discountPrice) * item.quantity;
      }
    });
  });

  const monthlySpending = Object.entries(monthMap)
    .map(([key, data]) => ({
      month: key.split("-")[1],
      fullKey: key,
      amount: data.amount,
      orders: data.orders,
      year: data.year,
      monthIndex: data.month,
    }))
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.monthIndex - b.monthIndex;
    });

  const weeklySpending = Object.entries(weekDayMap).map(([day, amount]) => ({
    day,
    amount,
  }));

  const categorySpending = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const sellerSpending = Object.entries(sellerMap)
    .map(([sellerId, data]) => ({
      sellerId,
      name: data.name,
      amount: data.amount,
      orders: data.orders.size,
    }))
    .sort((a, b) => b.amount - a.amount);

  const highestSpendingMonth = monthlySpending.length > 0
    ? monthlySpending.reduce((max, m) => (m.amount > max.amount ? m : max))
    : null;

  const totalSavings = totalDiscount + couponSavings;

  const currentMonthKey = `${new Date().getFullYear()}-${new Date().toLocaleString("default", { month: "short" })}`;
  const currentMonthData = monthMap[currentMonthKey];
  const prevMonthDate = new Date();
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${prevMonthDate.toLocaleString("default", { month: "short" })}`;
  const prevMonthData = monthMap[prevMonthKey];

  let spendingTrend = "stable";
  let spendingTrendPercent = 0;
  if (currentMonthData && prevMonthData && prevMonthData.amount > 0) {
    spendingTrendPercent = Math.round(((currentMonthData.amount - prevMonthData.amount) / prevMonthData.amount) * 100);
    spendingTrend = spendingTrendPercent > 0 ? "increasing" : spendingTrendPercent < 0 ? "decreasing" : "stable";
  }

  const insights: string[] = [];
  if (spendingTrendPercent !== 0) {
    const direction = spendingTrendPercent > 0 ? "more" : "less";
    insights.push(`You spent ${Math.abs(spendingTrendPercent)}% ${direction} this month compared to last month.`);
  }
  if (categorySpending.length > 0) {
    insights.push(`${categorySpending[0].category} is your highest-spending category.`);
  }
  if (couponSavings > 0) {
    insights.push(`You saved ৳${couponSavings.toLocaleString()} using coupons.`);
  }
  if (completedOrders > 0) {
    const avgIncrease = averageOrderValue > 2000 ? "high" : "moderate";
    insights.push(`Your average order value is ৳${averageOrderValue.toLocaleString()} (${avgIncrease}).`);
  }
  if (weeklySpending.length > 0) {
    const maxDay = weeklySpending.reduce((max, d) => (d.amount > max.amount ? d : max));
    if (maxDay.amount > 0) {
      insights.push(`You spend most on ${maxDay.day}s.`);
    }
  }

  const budget = await SpendingBudget.findOne({ userId });

  sendSuccess(res, {
    totalSpent,
    totalOrders,
    completedOrders,
    cancelledOrders: cancelledOrders.length,
    returnedOrders: returnedOrders.length,
    averageOrderValue,
    totalSavings,
    productDiscountSavings: totalDiscount,
    couponSavings,
    highestSpendingMonth: highestSpendingMonth
      ? { month: highestSpendingMonth.fullKey, amount: highestSpendingMonth.amount }
      : null,
    monthlySpending,
    weeklySpending,
    categorySpending,
    sellerSpending,
    spendingTrend,
    spendingTrendPercent,
    insights,
    budget: budget
      ? { monthlyBudget: budget.monthlyBudget, spent: currentMonthData?.amount || 0 }
      : null,
  });
});

export const getBudgetTracker = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const budget = await SpendingBudget.findOne({ userId });
  if (!budget) {
    return sendSuccess(res, { monthlyBudget: 0, spent: 0, remaining: 0, percentage: 0 });
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const monthlyOrders = await Order.find({
    userId,
    status: { $in: VALID_SPENDING_STATUSES },
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
  });

  const spent = monthlyOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const remaining = Math.max(0, budget.monthlyBudget - spent);
  const percentage = budget.monthlyBudget > 0 ? Math.round((spent / budget.monthlyBudget) * 100) : 0;

  let status: "under" | "near" | "exceeded" = "under";
  if (percentage >= 100) status = "exceeded";
  else if (percentage >= 80) status = "near";

  sendSuccess(res, {
    monthlyBudget: budget.monthlyBudget,
    spent,
    remaining,
    percentage,
    status,
    updatedAt: budget.updatedAt,
  });
});

export const updateBudget = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const { monthlyBudget } = req.body;
  if (!monthlyBudget || monthlyBudget < 0) {
    throw ApiError.badRequest("Valid monthly budget is required");
  }

  const budget = await SpendingBudget.findOneAndUpdate(
    { userId },
    { userId, monthlyBudget: Number(monthlyBudget), updatedAt: new Date() },
    { upsert: true, new: true }
  );

  sendSuccess(res, budget, "Budget updated successfully");
});

export const getSpendingReport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw ApiError.unauthorized("Authentication required");

  const range = (req.query.range as string) || "all";
  const dateFilter = buildDateFilter(range);

  const matchStage: Record<string, unknown> = { userId, status: { $in: VALID_SPENDING_STATUSES } };
  if (dateFilter.startDate || dateFilter.endDate) {
    matchStage.createdAt = {};
    if (dateFilter.startDate) (matchStage.createdAt as Record<string, Date>).$gte = dateFilter.startDate;
    if (dateFilter.endDate) (matchStage.createdAt as Record<string, Date>).$lte = dateFilter.endDate;
  }

  const orders = await Order.find(matchStage).sort({ createdAt: -1 });

  const headers = ["Order ID", "Date", "Status", "Items", "Subtotal", "Discount", "Total"];
  const rows = orders.map((o) => [
    o.id,
    new Date(o.createdAt).toLocaleDateString(),
    o.status,
    o.items.map((i) => `${i.title} x${i.quantity}`).join("; "),
    o.subtotal.toString(),
    o.discount.toString(),
    o.totalAmount.toString(),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="spending-report-${range}.csv"`);
  res.send(csv);
});
