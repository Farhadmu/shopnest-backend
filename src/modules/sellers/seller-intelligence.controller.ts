import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Store } from "./store.model";
import { Product } from "../products/product.model";
import { Order } from "../orders/order.model";
import { SellerGoal, AbExperiment } from "./seller-intelligence.model";
import { getAuthenticatedSellerContext } from "../../utils/seller-context";

// 11. SELLER HEALTH SCORE
export const getSellerHealthScore = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const store = await Store.findById(ctx.storeId);
  if (!store) throw ApiError.notFound("Store not found");

  const totalProducts = await Product.countDocuments({ storeId: ctx.storeId, isDeleted: false });
  const orders = await Order.find({ "items.storeId": ctx.storeId });

  const deliveredOrders = orders.filter((o) => o.status === "delivered").length;
  const returnedOrders = orders.filter((o) => o.status === "returned" || o.status === "refunded").length;
  const totalOrders = orders.length;

  const deliveryReliability = totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : null;
  const returnRatePercent = totalOrders > 0 ? Math.round((returnedOrders / totalOrders) * 100) : null;
  const customerSatisfaction = store.rating ? Math.min(100, Math.round(store.rating * 20)) : null;

  // Only calculate composite if we have enough data
  const hasEnoughData = totalOrders >= 3 && totalProducts >= 1;

  let overallHealth: number | null = null;
  if (hasEnoughData && deliveryReliability !== null && returnRatePercent !== null && customerSatisfaction !== null) {
    overallHealth = Math.round(
      customerSatisfaction * 0.30 +
      (deliveryReliability * 0.35) +
      (100 - Math.min(returnRatePercent * 3, 100)) * 0.35
    );
  }

  const recommendations: string[] = [];
  if (totalOrders === 0) {
    recommendations.push("Start receiving orders to calculate your health score.");
  } else {
    if (returnRatePercent !== null && returnRatePercent > 5) {
      recommendations.push("Review customer feedback on return reasons to optimize listing accuracy.");
    }
    if (deliveryReliability !== null && deliveryReliability < 90) {
      recommendations.push("Dispatch pending orders promptly to boost delivery reliability.");
    }
  }
  if (totalProducts < 3) {
    recommendations.push("Expand your active catalog with more products to increase buyer discovery.");
  }

  sendSuccess(res, {
    storeName: store.storeName,
    overallHealth,
    hasEnoughData,
    metrics: {
      customerSatisfaction: { score: customerSatisfaction, unit: "%", status: customerSatisfaction ? "calculated" : "no_data" },
      deliveryReliability: { score: deliveryReliability, unit: "%", status: deliveryReliability ? "calculated" : "no_data" },
      returnRate: { score: returnRatePercent, unit: "%", status: returnRatePercent ? "calculated" : "no_data" },
    },
    recommendations,
  });
});

// 12. AI SALES FORECASTING
export const getSalesForecast = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const orders = await Order.find({ "items.storeId": ctx.storeId, status: { $in: ["delivered", "shipped", "out_for_delivery"] } });

  if (orders.length < 3) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "Not enough historical sales data to generate a reliable forecast. Need at least 3 completed orders.",
      expectedRevenue: null,
      expectedOrders: null,
      confidenceScore: null,
      forecastDaily: [],
    });
  }

  const totalHistoricalRevenue = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  }, 0);

  const oldestOrder = orders.reduce((oldest, o) => o.createdAt < oldest.createdAt ? o : oldest, orders[0]);
  const daysSinceFirst = Math.max(1, Math.floor((Date.now() - oldestOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
  const dailyAvg = totalHistoricalRevenue / daysSinceFirst;

  const forecastDaily: Array<{ day: number; date: string; expectedRevenue: number; lowerBand: number; upperBand: number; expectedOrders: number }> = [];
  let totalForecastRevenue = 0;
  let totalForecastOrders = 0;

  for (let i = 1; i <= 30; i++) {
    const dateObj = new Date(Date.now() + i * 24 * 3600 * 1000);
    const dayOfWeek = dateObj.getDay();
    const weekendMultiplier = dayOfWeek === 5 || dayOfWeek === 6 ? 1.15 : 1.0;

    const expectedDayRevenue = Math.round(dailyAvg * weekendMultiplier);
    const lowerBand = Math.round(expectedDayRevenue * 0.7);
    const upperBand = Math.round(expectedDayRevenue * 1.3);
    const dayOrders = expectedDayRevenue > 0 ? Math.max(1, Math.round(expectedDayRevenue / (totalHistoricalRevenue / orders.length))) : 0;

    totalForecastRevenue += expectedDayRevenue;
    totalForecastOrders += dayOrders;

    forecastDaily.push({
      day: i,
      date: dateObj.toISOString().slice(0, 10),
      expectedRevenue: expectedDayRevenue,
      lowerBand,
      upperBand,
      expectedOrders: dayOrders,
    });
  }

  sendSuccess(res, {
    storeId: ctx.storeId,
    period: "Next 30 Days",
    hasEnoughData: true,
    expectedRevenue: totalForecastRevenue,
    expectedOrders: totalForecastOrders,
    confidenceScore: Math.min(85, 40 + orders.length * 2),
    growthRateProjected: null,
    forecastDaily,
    limitations: "Forecast is based on your store's historical order velocity. Actual results may vary based on market conditions, promotions, and seasonality.",
  });
});

// 13. DEMAND HEATMAP
export const getDemandHeatmap = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { timeframe = "30d" } = req.query;

  const days = Math.min(90, Math.max(7, parseInt(timeframe as string) || 30));
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const orders = await Order.find({
    "items.storeId": ctx.storeId,
    createdAt: { $gte: startDate },
  });

  if (orders.length === 0) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "Not enough order data to generate a demand heatmap. Start receiving orders to see geographic demand patterns.",
      timeframe,
      heatmapData: [],
    });
  }

  // Aggregate by division
  const divisionMap: Record<string, { orders: number; revenue: number }> = {};
  orders.forEach((o) => {
    const division = o.division || "Unknown";
    if (!divisionMap[division]) divisionMap[division] = { orders: 0, revenue: 0 };
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    divisionMap[division].orders += 1;
    divisionMap[division].revenue += sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  });

  const heatmapData = Object.entries(divisionMap)
    .map(([division, data]) => ({
      division,
      orders: data.orders,
      revenue: data.revenue,
      intensity: Math.min(100, Math.round((data.orders / Math.max(1, orders.length)) * 100)),
    }))
    .sort((a, b) => b.orders - a.orders);

  sendSuccess(res, {
    hasEnoughData: true,
    timeframe,
    heatmapData,
    totalOrders: orders.length,
    topDivision: heatmapData[0]?.division || null,
  });
});

// 14. SELLER GROWTH SIMULATOR
export const simulateGrowthScenario = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { currentPrice, newPrice, adSpend = 0, inventoryExpansion = 0 } = req.body;

  const orders = await Order.find({ "items.storeId": ctx.storeId, status: "delivered" });
  const products = await Product.find({ storeId: ctx.storeId, isDeleted: false });

  const currentRevenue = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  }, 0);

  const avgPrice = products.length > 0
    ? products.reduce((s, p) => s + (p.discountPrice || p.price), 0) / products.length
    : currentPrice || 1000;

  const effectiveCurrentPrice = currentPrice || avgPrice;
  const effectiveNewPrice = newPrice || avgPrice;
  const priceDeltaPercent = ((effectiveNewPrice - effectiveCurrentPrice) / effectiveCurrentPrice) * 100;

  const elasticity = -1.6;
  const salesVolumeDeltaPercent = Math.round(priceDeltaPercent * elasticity + (adSpend / 1000) * 1.8);
  const revenueDeltaPercent = Math.round(salesVolumeDeltaPercent + priceDeltaPercent);

  sendSuccess(res, {
    currentBaseline: {
      avgPrice: Math.round(effectiveCurrentPrice),
      monthlyOrders: orders.length,
      monthlyRevenue: currentRevenue,
    },
    simulatedScenario: {
      newPrice: Math.round(effectiveNewPrice),
      adSpend,
      inventoryExpansion,
    },
    projectedImpact: {
      salesVolumeChange: `${salesVolumeDeltaPercent > 0 ? "+" : ""}${salesVolumeDeltaPercent}%`,
      revenueChange: `${revenueDeltaPercent > 0 ? "+" : ""}${revenueDeltaPercent}%`,
      estimatedOrdersChange: Math.round((salesVolumeDeltaPercent / 100) * orders.length),
    },
    isSimulation: true,
    disclaimer: "This is a simulation based on price elasticity models. Actual results will vary based on market conditions, competition, and customer behavior.",
  });
});

// 15. AI MARKETING CAMPAIGN SIMULATOR
export const simulateCampaign = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { campaignName = "Campaign", discountPercent = 10, durationDays = 7 } = req.body;

  const orders = await Order.find({ "items.storeId": ctx.storeId, status: "delivered" });
  const avgOrderValue = orders.length > 0
    ? Math.round(orders.reduce((s, o) => s + o.totalAmount, 0) / orders.length)
    : null;

  if (!avgOrderValue) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "Not enough order data to simulate a campaign. Need at least 1 completed order.",
    });
  }

  const baseDailyOrders = orders.length / 30;
  const discountBoost = 1 + (discountPercent / 100) * 1.5;
  const estimatedDailyOrders = Math.round(baseDailyOrders * discountBoost);
  const estimatedOrders = estimatedDailyOrders * durationDays;
  const grossRevenue = estimatedOrders * avgOrderValue;
  const discountCost = Math.round(grossRevenue * (discountPercent / 100));
  const netRevenue = grossRevenue - discountCost;

  sendSuccess(res, {
    hasEnoughData: true,
    campaignName,
    discountPercent,
    durationDays,
    currentBaseline: {
      avgDailyOrders: Math.round(baseDailyOrders * 10) / 10,
      avgOrderValue,
    },
    simulation: {
      estimatedOrders,
      grossRevenue,
      discountCost,
      netRevenue,
    },
    isSimulation: true,
    disclaimer: "Simulation based on your store's actual order history. Actual campaign results will vary.",
  });
});

// 16. CUSTOMER SEGMENTS
export const getCustomerSegments = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const orders = await Order.find({ "items.storeId": ctx.storeId });

  if (orders.length === 0) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "No customer purchase history available yet.",
      totalCustomersTracked: 0,
      segments: [],
    });
  }

  const customerMap: Record<string, { orders: number; totalSpent: number; lastOrder: Date }> = {};
  orders.forEach((o) => {
    const buyerId = o.userId;
    if (!customerMap[buyerId]) {
      customerMap[buyerId] = { orders: 0, totalSpent: 0, lastOrder: o.createdAt };
    }
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    customerMap[buyerId].orders += 1;
    customerMap[buyerId].totalSpent += sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
    if (o.createdAt > customerMap[buyerId].lastOrder) {
      customerMap[buyerId].lastOrder = o.createdAt;
    }
  });

  const customers = Object.values(customerMap);
  const totalCustomers = customers.length;

  const segments = [
    {
      name: "One-Time Buyers",
      count: customers.filter((c) => c.orders === 1).length,
      percentage: Math.round((customers.filter((c) => c.orders === 1).length / totalCustomers) * 100),
      description: "Customers who made a single purchase",
    },
    {
      name: "Returning Customers",
      count: customers.filter((c) => c.orders >= 2 && c.orders < 5).length,
      percentage: Math.round((customers.filter((c) => c.orders >= 2 && c.orders < 5).length / totalCustomers) * 100),
      description: "Customers with 2-4 orders",
    },
    {
      name: "Loyal Customers",
      count: customers.filter((c) => c.orders >= 5).length,
      percentage: Math.round((customers.filter((c) => c.orders >= 5).length / totalCustomers) * 100),
      description: "Customers with 5+ orders",
    },
  ];

  sendSuccess(res, {
    hasEnoughData: true,
    totalCustomersTracked: totalCustomers,
    totalOrders: orders.length,
    segments,
  });
});

// 17. SELLER CHURN PREDICTOR
export const getChurnPredictor = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const orders = await Order.find({ "items.storeId": ctx.storeId });

  if (orders.length === 0) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "No customer data available for churn analysis.",
      riskTiers: { highRisk: { count: 0, percentage: 0 }, mediumRisk: { count: 0, percentage: 0 }, lowRisk: { count: 0, percentage: 0 } },
    });
  }

  const customerMap: Record<string, { lastOrder: Date; orderCount: number }> = {};
  orders.forEach((o) => {
    if (!customerMap[o.userId] || o.createdAt > customerMap[o.userId].lastOrder) {
      customerMap[o.userId] = { lastOrder: o.createdAt, orderCount: (customerMap[o.userId]?.orderCount || 0) + 1 };
    }
  });

  const now = Date.now();
  const INACTIVE_THRESHOLD = 60 * 24 * 60 * 60 * 1000; // 60 days

  const customers = Object.values(customerMap);
  const highRisk = customers.filter((c) => now - c.lastOrder.getTime() > INACTIVE_THRESHOLD && c.orderCount >= 2);
  const mediumRisk = customers.filter((c) => now - c.lastOrder.getTime() > INACTIVE_THRESHOLD / 2 && now - c.lastOrder.getTime() <= INACTIVE_THRESHOLD);
  const lowRisk = customers.filter((c) => now - c.lastOrder.getTime() <= INACTIVE_THRESHOLD / 2);

  const total = customers.length;

  sendSuccess(res, {
    hasEnoughData: true,
    riskTiers: {
      highRisk: { count: highRisk.length, percentage: Math.round((highRisk.length / total) * 100), description: "No purchase in 60+ days after previous orders" },
      mediumRisk: { count: mediumRisk.length, percentage: Math.round((mediumRisk.length / total) * 100), description: "No purchase in 30+ days" },
      lowRisk: { count: lowRisk.length, percentage: Math.round((lowRisk.length / total) * 100), description: "Active within last 30 days" },
    },
    inactiveThresholdDays: 60,
  });
});

// 18. PRODUCT PROFITABILITY ANALYZER
export const getProfitabilityAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const orders = await Order.find({ "items.storeId": ctx.storeId, status: { $in: ["delivered", "shipped", "out_for_delivery"] } });
  const products = await Product.find({ storeId: ctx.storeId, isDeleted: false });

  const revenue = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  }, 0);

  // Check if we have cost data
  const productsWithCost = products.filter((p) => (p as any).costPrice !== undefined);
  const hasCostData = productsWithCost.length > 0;

  if (!hasCostData) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "Profitability cannot be calculated because product cost data is unavailable. Add cost price to your products to enable profit tracking.",
      revenue,
      orderCount: orders.length,
      hasCostData: false,
    });
  }

  // Calculate real profit from cost data
  let totalCost = 0;
  orders.forEach((o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    sellerItems.forEach((item) => {
      const product = products.find((p) => p._id.toString() === item.productId);
      const costPrice = product ? (product as any).costPrice || 0 : 0;
      totalCost += costPrice * item.quantity;
    });
  });

  const grossProfit = revenue - totalCost;
  const netMarginPercent = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;

  sendSuccess(res, {
    hasEnoughData: true,
    hasCostData: true,
    summary: {
      revenue,
      totalCost,
      grossProfit,
      netMarginPercent: `${netMarginPercent}%`,
    },
    orderCount: orders.length,
    productCount: products.length,
  });
});

// 19. SELLER GOALS & KPI SYSTEM
export const getSellerGoals = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);

  const orders = await Order.find({ "items.storeId": ctx.storeId });
  const realRevenue = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  }, 0);
  const realDelivered = orders.filter((o) => o.status === "delivered").length;

  const goals = await SellerGoal.find({ storeId: ctx.storeId });

  // Sync current values with real data
  const syncedGoals = goals.map((g) => {
    if (g.metricType === "revenue") g.currentValue = realRevenue;
    if (g.metricType === "orders") g.currentValue = realDelivered;
    return g;
  });

  sendSuccess(res, syncedGoals);
});

export const createSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { title, metricType, targetValue, unit, deadline, period } = req.body;

  const goal = await SellerGoal.create({
    sellerId: ctx.sellerId,
    storeId: ctx.storeId,
    title,
    metricType,
    targetValue: Number(targetValue),
    currentValue: 0,
    unit: unit || "৳",
    deadline: new Date(deadline),
    period: period || "monthly",
    status: "in_progress",
  });

  sendSuccess(res, goal.toJSON(), "Goal created", 201);
});

export const deleteSellerGoal = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { id } = req.params;

  const goal = await SellerGoal.findOneAndDelete({ _id: id, storeId: ctx.storeId });
  if (!goal) throw ApiError.notFound("Goal not found");

  sendSuccess(res, { deleted: true }, "Goal removed");
});

// 20. SELLER A/B TESTING
export const getAbExperiments = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const experiments = await AbExperiment.find({ storeId: ctx.storeId });
  sendSuccess(res, experiments);
});

export const createAbExperiment = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { productId, productTitle, testType, variantAValue, variantBValue } = req.body;

  const experiment = await AbExperiment.create({
    sellerId: ctx.sellerId,
    storeId: ctx.storeId,
    productId,
    productTitle,
    testType,
    variantA: { name: "A", value: variantAValue, views: 0, clicks: 0, cartAdds: 0, orders: 0, revenue: 0, conversionRate: 0 },
    variantB: { name: "B", value: variantBValue, views: 0, clicks: 0, cartAdds: 0, orders: 0, revenue: 0, conversionRate: 0 },
    status: "active",
    confidenceScore: 50,
  });

  sendSuccess(res, experiment.toJSON(), "A/B Experiment launched", 201);
});

// 21. ADVANCED SELLER ANALYTICS
export const getSellerAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const { range = "30d" } = req.query as { range?: string };

  const rangeDays = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const startDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  const products = await Product.find({ storeId: ctx.storeId, isDeleted: false });
  const orders = await Order.find({ "items.storeId": ctx.storeId, createdAt: { $gte: startDate } });

  const totalRevenue = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
  }, 0);

  const totalOrders = orders.length;
  const productsSold = orders.reduce((sum, o) => {
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    return sum + sellerItems.reduce((s, i) => s + i.quantity, 0);
  }, 0);
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Real timeline points
  const trendMap: Record<string, { revenue: number; orders: number }> = {};
  orders.forEach((o) => {
    const d = new Date(o.createdAt);
    const label = rangeDays <= 7 ? d.toLocaleDateString("default", { weekday: "short" }) : d.toLocaleDateString("default", { month: "short", day: "numeric" });
    if (!trendMap[label]) trendMap[label] = { revenue: 0, orders: 0 };
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    trendMap[label].revenue += sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
    trendMap[label].orders += 1;
  });

  const trendPoints = Object.entries(trendMap).map(([label, data]) => ({
    label,
    revenue: data.revenue,
    orders: data.orders,
  }));

  // Real product performance
  const topProducts = products.map((p) => ({
    id: p._id.toString(),
    title: p.title,
    price: p.discountPrice || p.price,
    sold: p.sold || 0,
    revenue: (p.sold || 0) * (p.discountPrice || p.price),
  })).sort((a, b) => b.sold - a.sold).slice(0, 5);

  sendSuccess(res, {
    range,
    hasEnoughData: totalOrders > 0,
    kpis: {
      totalRevenue,
      totalOrders,
      productsSold,
      avgOrderValue,
    },
    trendPoints,
    topProducts,
    productCount: products.length,
  });
});

// 22. SMART INVENTORY INTELLIGENCE
export const getInventoryIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const products = await Product.find({ storeId: ctx.storeId, isDeleted: false });

  if (products.length === 0) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "No products found. Add products to see inventory intelligence.",
      inventoryHealthScore: null,
      items: [],
    });
  }

  const inventoryItems = products.map((p) => {
    const stock = p.stock || 0;
    const sold = p.sold || 0;
    const isOut = stock === 0;
    const isLow = stock > 0 && stock <= 10;

    return {
      id: p._id.toString(),
      title: p.title,
      currentStock: stock,
      price: p.discountPrice || p.price,
      category: p.category,
      sold,
      stockOutRisk: isOut ? "Critical" : isLow ? "High" : stock > 100 ? "Low" : "Medium",
      restockPriority: isOut ? "Immediate Action Required" : isLow ? "Restock within 48h" : "Healthy Stock",
      estimatedDaysRemaining: isOut ? 0 : sold > 0 ? Math.max(1, Math.round(stock / (sold / 30))) : null,
    };
  });

  const lowStockCount = inventoryItems.filter((i) => i.currentStock <= 10 && i.currentStock > 0).length;
  const outOfStockCount = inventoryItems.filter((i) => i.currentStock === 0).length;
  const totalItems = inventoryItems.length;

  const inventoryHealthScore = totalItems > 0
    ? Math.max(20, Math.min(100, 100 - (lowStockCount * 8 + outOfStockCount * 25)))
    : null;

  sendSuccess(res, {
    hasEnoughData: true,
    inventoryHealthScore,
    summary: {
      totalItems,
      healthyStockCount: totalItems - (lowStockCount + outOfStockCount),
      lowStockCount,
      outOfStockCount,
    },
    items: inventoryItems,
  });
});

// 23. CUSTOMER INSIGHTS
export const getCustomerInsights = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await getAuthenticatedSellerContext(req);
  const orders = await Order.find({ "items.storeId": ctx.storeId });

  if (orders.length === 0) {
    return sendSuccess(res, {
      hasEnoughData: false,
      message: "No customer purchase history available yet.",
      overview: { totalCustomers: 0, totalOrders: 0 },
    });
  }

  const customerMap: Record<string, { orders: number; totalSpent: number; lastOrder: Date }> = {};
  orders.forEach((o) => {
    if (!customerMap[o.userId]) {
      customerMap[o.userId] = { orders: 0, totalSpent: 0, lastOrder: o.createdAt };
    }
    const sellerItems = o.items.filter((i) => i.storeId === ctx.storeId);
    customerMap[o.userId].orders += 1;
    customerMap[o.userId].totalSpent += sellerItems.reduce((s, i) => s + i.price * i.quantity, 0);
    if (o.createdAt > customerMap[o.userId].lastOrder) {
      customerMap[o.userId].lastOrder = o.createdAt;
    }
  });

  const customers = Object.values(customerMap);
  const totalCustomers = customers.length;
  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  const returningCustomers = customers.filter((c) => c.orders >= 2).length;

  sendSuccess(res, {
    hasEnoughData: true,
    overview: {
      totalCustomers,
      totalOrders: orders.length,
      totalRevenue,
      returningCustomers,
      repeatPurchaseRate: totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 100) : 0,
      averageOrderValue: Math.round(totalRevenue / orders.length),
    },
  });
});
