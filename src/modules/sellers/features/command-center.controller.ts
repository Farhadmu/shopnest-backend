import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { sendSuccess } from "../../../utils/api-response";
import { getSellerContext, getSellerStore } from "../seller-store.util";
import { Review } from "../../reviews/review.model";

export const getSellerCommandCenter = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || "demo-seller";
  const {
    store,
    products,
    sellerOrders,
    totalRevenue: allTimeRevenue,
    totalOrders: allTimeOrders,
    deliveredOrders: allTimeDelivered,
    returnedOrders: allTimeReturned,
    pendingOrders: allTimePending,
    uniqueBuyerIds,
  } = await getSellerContext(userId);

  const { range = "30d" } = req.query as { range?: string };

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Time window calculation for active range & previous comparison range
  let rangeMs = 30 * 24 * 60 * 60 * 1000;
  if (range === "today") {
    rangeMs = 24 * 60 * 60 * 1000;
  } else if (range === "7d") {
    rangeMs = 7 * 24 * 60 * 60 * 1000;
  } else if (range === "3m") {
    rangeMs = 90 * 24 * 60 * 60 * 1000;
  } else if (range === "6m") {
    rangeMs = 180 * 24 * 60 * 60 * 1000;
  } else if (range === "1y") {
    rangeMs = 365 * 24 * 60 * 60 * 1000;
  }

  const rangeCutoff = range === "today" ? startOfToday : new Date(now - rangeMs);
  const prevCutoff = range === "today" 
    ? new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000) 
    : new Date(now - rangeMs * 2);

  // Filter orders by range & previous period
  const currentRangeOrders = sellerOrders.filter((o: any) => new Date(o.createdAt) >= rangeCutoff);
  const prevRangeOrders = sellerOrders.filter((o: any) => {
    const d = new Date(o.createdAt);
    return d >= prevCutoff && d < rangeCutoff;
  });

  const todayOrders = sellerOrders.filter((o: any) => new Date(o.createdAt) >= startOfToday);

  // Revenue and quantity calculations
  const todayRevenue = todayOrders.reduce((sum, o) => sum + (o.sellerSubtotal || 0), 0);
  const rangeRevenue = currentRangeOrders.reduce((sum, o) => sum + (o.sellerSubtotal || 0), 0);
  const prevRevenue = prevRangeOrders.reduce((sum, o) => sum + (o.sellerSubtotal || 0), 0);

  let rangeProductsSold = 0;
  currentRangeOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      rangeProductsSold += it.quantity || 1;
    });
  });

  let prevProductsSold = 0;
  prevRangeOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      prevProductsSold += it.quantity || 1;
    });
  });

  const rangeOrderCount = currentRangeOrders.length;
  const prevOrderCount = prevRangeOrders.length;

  // Growth percentages (null if prior history is 0)
  const revenueGrowthPct = prevRevenue > 0
    ? Number((((rangeRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1))
    : (rangeRevenue > 0 && prevOrderCount === 0 ? 100 : null);

  const ordersGrowthPct = prevOrderCount > 0
    ? Number((((rangeOrderCount - prevOrderCount) / prevOrderCount) * 100).toFixed(1))
    : (rangeOrderCount > 0 && prevOrderCount === 0 ? 100 : null);

  const avgOrderValue = rangeOrderCount > 0
    ? Math.round(rangeRevenue / rangeOrderCount)
    : (allTimeOrders > 0 ? Math.round(allTimeRevenue / allTimeOrders) : 0);

  // Pipeline order breakdown
  const pendingOrders = sellerOrders.filter((o: any) => o.status === "pending").length;
  const processingOrders = sellerOrders.filter((o: any) => o.status === "processing" || o.status === "confirmed").length;
  const shippedOrders = sellerOrders.filter((o: any) => o.status === "shipped" || o.status === "out_for_delivery").length;
  const deliveredOrders = sellerOrders.filter((o: any) => o.status === "delivered").length;
  const cancelledOrders = sellerOrders.filter((o: any) => o.status === "cancelled").length;
  const returnedOrders = sellerOrders.filter((o: any) => o.status === "returned" || o.status === "refunded").length;

  // Inventory analysis
  const totalProducts = products.length;
  const healthyStockProducts = products.filter((p: any) => (p.stock || 0) > 10);
  const lowStockProducts = products.filter((p: any) => (p.stock || 0) > 0 && (p.stock || 0) <= 10);
  const outOfStockProducts = products.filter((p: any) => (p.stock || 0) === 0);

  // Product sales aggregation
  const productSalesMap = new Map<string, { unitsSold: number; revenue: number; orderCount: number }>();
  sellerOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      const pId = it.productId?.toString();
      if (!pId) return;
      const existing = productSalesMap.get(pId) || { unitsSold: 0, revenue: 0, orderCount: 0 };
      existing.unitsSold += it.quantity || 1;
      existing.revenue += (it.price || 0) * (it.quantity || 1);
      existing.orderCount += 1;
      productSalesMap.set(pId, existing);
    });
  });

  const enrichedProducts = products.map((p: any) => {
    const pId = p._id?.toString() || p.id;
    const sales = productSalesMap.get(pId) || { unitsSold: p.sold || 0, revenue: (p.sold || 0) * (p.price || 0), orderCount: 0 };
    return {
      id: pId,
      title: p.title,
      category: p.category,
      price: p.price,
      discountPrice: p.discountPrice,
      stock: p.stock ?? 0,
      image: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : "",
      sold: sales.unitsSold,
      revenue: sales.revenue,
      ratingAvg: p.ratingAvg || 0,
      ratingCount: p.ratingCount || 0,
      views: p.views || 0,
      status: p.status || "approved",
    };
  });

  // Top products (highest revenue/units)
  const topProducts = [...enrichedProducts]
    .filter((p) => p.sold > 0 || p.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.sold - a.sold)
    .slice(0, 5);

  // Underperforming products (in-stock products with zero or lowest sales)
  const underperformingProducts = [...enrichedProducts]
    .filter((p) => p.stock > 0 && p.sold <= 1)
    .sort((a, b) => a.sold - b.sold || b.stock - a.stock)
    .slice(0, 5);

  // Category sales breakdown
  const categoryRevenueMap = new Map<string, { revenue: number; orders: number; units: number }>();
  currentRangeOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      // Find category from product or default to 'General'
      const matchedProd = products.find((p: any) => (p._id?.toString() || p.id) === it.productId);
      const cat = matchedProd?.category || "General";
      const existing = categoryRevenueMap.get(cat) || { revenue: 0, orders: 0, units: 0 };
      existing.revenue += (it.price || 0) * (it.quantity || 1);
      existing.orders += 1;
      existing.units += it.quantity || 1;
      categoryRevenueMap.set(cat, existing);
    });
  });

  const categoryPerformance = Array.from(categoryRevenueMap.entries()).map(([category, val]) => ({
    category,
    revenue: val.revenue,
    orders: val.orders,
    units: val.units,
    sharePercent: rangeRevenue > 0 ? Math.round((val.revenue / rangeRevenue) * 100) : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  // Continuous Trend Data points
  const trendPoints: Array<{ label: string; revenue: number; orders: number; unitsSold: number }> = [];

  if (range === "today") {
    // 6 4-hour intervals
    for (let h = 0; h < 24; h += 4) {
      const intervalStart = new Date(startOfToday.getTime() + h * 60 * 60 * 1000).getTime();
      const intervalEnd = intervalStart + 4 * 60 * 60 * 1000;
      const intervalOrders = todayOrders.filter((o: any) => {
        const t = new Date(o.createdAt).getTime();
        return t >= intervalStart && t < intervalEnd;
      });
      let rev = 0;
      let units = 0;
      intervalOrders.forEach((o: any) => {
        rev += o.sellerSubtotal || 0;
        (o.items || []).forEach((it: any) => { units += it.quantity || 1; });
      });
      trendPoints.push({
        label: `${h.toString().padStart(2, "0")}:00`,
        revenue: rev,
        orders: intervalOrders.length,
        unitsSold: units,
      });
    }
  } else if (range === "7d") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const dayName = days[d.getDay()];
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      const dayOrders = currentRangeOrders.filter((o: any) => {
        const ot = new Date(o.createdAt).getTime();
        return ot >= dayStart && ot < dayEnd;
      });

      let dayRev = 0;
      let dayUnits = 0;
      dayOrders.forEach((o: any) => {
        dayRev += o.sellerSubtotal || 0;
        (o.items || []).forEach((it: any) => { dayUnits += it.quantity || 1; });
      });

      trendPoints.push({
        label: dayName,
        revenue: dayRev,
        orders: dayOrders.length,
        unitsSold: dayUnits,
      });
    }
  } else if (range === "30d") {
    for (let i = 3; i >= 0; i--) {
      const wStart = new Date(now - (i + 1) * 7 * 24 * 60 * 60 * 1000).getTime();
      const wEnd = new Date(now - i * 7 * 24 * 60 * 60 * 1000).getTime();

      const weekOrders = currentRangeOrders.filter((o: any) => {
        const ot = new Date(o.createdAt).getTime();
        return ot >= wStart && ot < wEnd;
      });

      let wRev = 0;
      let wUnits = 0;
      weekOrders.forEach((o: any) => {
        wRev += o.sellerSubtotal || 0;
        (o.items || []).forEach((it: any) => { wUnits += it.quantity || 1; });
      });

      trendPoints.push({
        label: `Wk ${4 - i}`,
        revenue: wRev,
        orders: weekOrders.length,
        unitsSold: wUnits,
      });
    }
  } else {
    // Monthly buckets for 3m, 6m, 1y
    const monthsCount = range === "3m" ? 3 : range === "6m" ? 6 : 12;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = monthsCount - 1; i >= 0; i--) {
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() - i);
      const mYear = targetDate.getFullYear();
      const mMonth = targetDate.getMonth();
      const mStart = new Date(mYear, mMonth, 1).getTime();
      const mEnd = new Date(mYear, mMonth + 1, 1).getTime();

      const monthOrders = currentRangeOrders.filter((o: any) => {
        const ot = new Date(o.createdAt).getTime();
        return ot >= mStart && ot < mEnd;
      });

      let mRev = 0;
      let mUnits = 0;
      monthOrders.forEach((o: any) => {
        mRev += o.sellerSubtotal || 0;
        (o.items || []).forEach((it: any) => { mUnits += it.quantity || 1; });
      });

      trendPoints.push({
        label: `${monthNames[mMonth]}`,
        revenue: mRev,
        orders: monthOrders.length,
        unitsSold: mUnits,
      });
    }
  }

  // Action Center dynamic alerts
  const actionCenterItems: Array<{
    id: string;
    type: "low_stock" | "pending_orders" | "cancellation_spike" | "negative_review" | "onboarding" | "campaign";
    priority: "critical" | "high" | "warning" | "info";
    title: string;
    description: string;
    actionLabel: string;
    actionHref: string;
  }> = [];

  if (pendingOrders > 0) {
    actionCenterItems.push({
      id: "action-pending-orders",
      type: "pending_orders",
      priority: pendingOrders >= 5 ? "critical" : "high",
      title: `${pendingOrders} Order(s) Awaiting Fulfillment`,
      description: `Buyers are waiting for package dispatch. Fulfill quickly to maintain high delivery trust scores.`,
      actionLabel: "Fulfill Orders",
      actionHref: "/dashboard/seller/orders",
    });
  }

  if (outOfStockProducts.length > 0) {
    actionCenterItems.push({
      id: "action-out-of-stock",
      type: "low_stock",
      priority: "critical",
      title: `${outOfStockProducts.length} Product(s) Completely Out of Stock`,
      description: `Items like "${outOfStockProducts[0].title}" have zero inventory and cannot receive new customer orders.`,
      actionLabel: "Restock Inventory",
      actionHref: "/dashboard/seller/inventory",
    });
  } else if (lowStockProducts.length > 0) {
    actionCenterItems.push({
      id: "action-low-stock",
      type: "low_stock",
      priority: "warning",
      title: `${lowStockProducts.length} Product(s) Running Low`,
      description: `Stock is 10 units or fewer on items like "${lowStockProducts[0].title}".`,
      actionLabel: "Manage Stock",
      actionHref: "/dashboard/seller/inventory",
    });
  }

  const cancelRate = allTimeOrders > 0 ? (cancelledOrders / allTimeOrders) * 100 : 0;
  if (cancelRate > 15 && cancelledOrders >= 2) {
    actionCenterItems.push({
      id: "action-cancellation",
      type: "cancellation_spike",
      priority: "high",
      title: `High Cancellation Rate (${cancelRate.toFixed(1)}%)`,
      description: `Elevated cancellations impact store health. Inspect order issues to protect seller rating.`,
      actionLabel: "Review Risk Telemetry",
      actionHref: "/dashboard/seller/risk-indicators",
    });
  }

  if (totalProducts === 0) {
    actionCenterItems.push({
      id: "action-onboarding-add",
      type: "onboarding",
      priority: "critical",
      title: "Add Your First Product",
      description: "Your storefront is live but empty. List your products to start receiving customer orders.",
      actionLabel: "+ Add Product",
      actionHref: "/dashboard/seller/products/add",
    });
  }

  // Recent 8 seller orders
  const recentOrders = sellerOrders.slice(0, 8).map((o: any) => ({
    orderId: o.orderId,
    userId: o.userId,
    customerName: o.rawOrder?.shippingAddress?.split(",")?.[0]?.trim() || "Customer",
    status: o.status,
    paymentStatus: o.paymentStatus || "unpaid",
    createdAt: o.createdAt,
    sellerSubtotal: o.sellerSubtotal,
    itemCount: o.items.reduce((s: number, it: any) => s + (it.quantity || 1), 0),
    items: o.items.map((it: any) => ({
      productId: it.productId,
      title: it.title,
      price: it.price,
      quantity: it.quantity,
      image: it.image || "",
    })),
  }));

  // Reviews telemetry
  const productIds = products.map((p: any) => p._id?.toString() || p.id).filter(Boolean);
  const sellerReviews = productIds.length > 0
    ? await Review.find({ productId: { $in: productIds } }).sort({ createdAt: -1 }).limit(10).lean()
    : [];

  const reviewAvg = sellerReviews.length > 0
    ? Number((sellerReviews.reduce((sum, r) => sum + (r.rating || 5), 0) / sellerReviews.length).toFixed(1))
    : (store.rating || 5.0);

  // Profit Intelligence calculation (only from real transactions)
  // Standard marketplace platform commission 5% (clearly marked)
  const platformFeeRate = 0.05;
  const estimatedDiscounts = currentRangeOrders.reduce((sum, o) => {
    // If order has total discount, take proportional share
    const totalOrderSub = o.rawOrder?.subtotal || o.sellerSubtotal || 1;
    const orderDisc = o.rawOrder?.discount || 0;
    const sellerShare = (o.sellerSubtotal / totalOrderSub);
    return sum + Math.round(orderDisc * sellerShare);
  }, 0);

  const estimatedPlatformFee = Math.round(rangeRevenue * platformFeeRate);
  const estimatedNetProfit = Math.max(0, rangeRevenue - estimatedDiscounts - estimatedPlatformFee);
  const profitMarginPercent = rangeRevenue > 0 ? Math.round((estimatedNetProfit / rangeRevenue) * 100) : 0;

  // Seller Health Score composite
  const deliveryReliability = allTimeOrders > 0 ? Math.round((allTimeDelivered / allTimeOrders) * 100) : 100;
  const returnRatePercent = allTimeOrders > 0 ? Math.round((allTimeReturned / allTimeOrders) * 100) : 0;
  const catalogReadiness = totalProducts >= 10 ? 100 : totalProducts >= 5 ? 80 : totalProducts >= 1 ? 50 : 20;
  
  let overallHealth = 0;
  if (allTimeOrders > 0) {
    overallHealth = Math.round(
      Math.min(100, reviewAvg * 20) * 0.30 +
      deliveryReliability * 0.30 +
      (100 - Math.min(100, returnRatePercent * 5)) * 0.20 +
      catalogReadiness * 0.20
    );
  } else {
    overallHealth = Math.round(catalogReadiness * 0.70 + 30);
  }
  overallHealth = Math.max(20, Math.min(100, overallHealth));

  // AI Insights generated dynamically from real store state
  const aiInsights: Array<{ title: string; category: string; text: string; impact: "positive" | "warning" | "suggestion" }> = [];
  
  if (categoryPerformance.length > 0) {
    const topCat = categoryPerformance[0];
    aiInsights.push({
      title: "Category Growth Driver",
      category: "Sales Analytics",
      text: `Your "${topCat.category}" category generates ${topCat.sharePercent}% of your total revenue (৳${topCat.revenue.toLocaleString()}). Increasing stock in this segment will yield high returns.`,
      impact: "positive",
    });
  }

  if (revenueGrowthPct !== null && revenueGrowthPct > 0) {
    aiInsights.push({
      title: "Positive Sales Momentum",
      category: "Growth Trend",
      text: `Revenue grew by +${revenueGrowthPct}% compared to the prior period (${range}). Sales velocity is accelerating across top products.`,
      impact: "positive",
    });
  } else if (revenueGrowthPct !== null && revenueGrowthPct < 0) {
    aiInsights.push({
      title: "Revenue Pace Adjustment",
      category: "Sales Velocity",
      text: `Revenue adjusted by ${revenueGrowthPct}% vs the previous period. Consider launching promotional coupons or running a flash campaign.`,
      impact: "warning",
    });
  }

  if (lowStockProducts.length > 0 || outOfStockProducts.length > 0) {
    aiInsights.push({
      title: "Inventory Restock Priority",
      category: "Supply Chain",
      text: `${lowStockProducts.length + outOfStockProducts.length} items require inventory replenishment to prevent lost order conversions.`,
      impact: "warning",
    });
  }

  if (allTimeOrders > 0) {
    const repeatBuyers = uniqueBuyerIds.length > 0
      ? sellerOrders.length - uniqueBuyerIds.length
      : 0;
    const repeatRate = uniqueBuyerIds.length > 0 ? Math.round((repeatBuyers / sellerOrders.length) * 100) : 0;
    aiInsights.push({
      title: "Customer Retention Telemetry",
      category: "Buyer Loyalty",
      text: `You have ${uniqueBuyerIds.length} unique buyer(s) with an estimated ${repeatRate}% repeat order activity rate.`,
      impact: "suggestion",
    });
  } else {
    aiInsights.push({
      title: "Store Launch Optimization",
      category: "Store Growth",
      text: "Expand your catalog with high-resolution imagery and clear tags to drive initial product discovery across the marketplace.",
      impact: "suggestion",
    });
  }

  // Response Payload
  sendSuccess(res, {
    header: {
      sellerName: req.user?.name || "Seller",
      storeName: store.storeName || "My ShopNest Store",
      slug: store.slug,
      status: store.status || "approved",
      trustScore: store.trustScore || overallHealth,
      rating: reviewAvg,
      ratingCount: sellerReviews.length,
      followersCount: store.followersCount || 0,
      logo: store.logo || "",
      banner: store.banner || "",
    },
    dateRange: range,
    metrics: {
      todayRevenue,
      todayOrders: todayOrders.length,
      totalRevenue: allTimeRevenue,
      rangeRevenue,
      previousRangeRevenue: prevRevenue,
      revenueGrowthPct,
      rangeOrders: rangeOrderCount,
      previousRangeOrders: prevOrderCount,
      ordersGrowthPct,
      productsSold: rangeProductsSold,
      avgOrderValue,
      pendingOrders,
      processingOrders,
      shippedOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      totalProducts,
      healthyStockCount: healthyStockProducts.length,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      storeRating: reviewAvg,
      estimatedProfit: estimatedNetProfit,
    },
    salesPerformance: {
      trendPoints,
      categoryPerformance,
    },
    actionCenter: actionCenterItems,
    orderPipeline: {
      pending: { count: pendingOrders, percent: allTimeOrders > 0 ? Math.round((pendingOrders / allTimeOrders) * 100) : 0 },
      processing: { count: processingOrders, percent: allTimeOrders > 0 ? Math.round((processingOrders / allTimeOrders) * 100) : 0 },
      shipped: { count: shippedOrders, percent: allTimeOrders > 0 ? Math.round((shippedOrders / allTimeOrders) * 100) : 0 },
      delivered: { count: deliveredOrders, percent: allTimeOrders > 0 ? Math.round((deliveredOrders / allTimeOrders) * 100) : 0 },
      cancelled: { count: cancelledOrders, percent: allTimeOrders > 0 ? Math.round((cancelledOrders / allTimeOrders) * 100) : 0 },
      returned: { count: returnedOrders, percent: allTimeOrders > 0 ? Math.round((returnedOrders / allTimeOrders) * 100) : 0 },
    },
    recentOrders,
    inventoryCommand: {
      healthyCount: healthyStockProducts.length,
      lowStockCount: lowStockProducts.length,
      outOfStockCount: outOfStockProducts.length,
      totalCatalogUnits: products.reduce((s: number, p: any) => s + (p.stock || 0), 0),
      topLowStock: lowStockProducts.concat(outOfStockProducts).slice(0, 6).map((p: any) => ({
        id: p._id?.toString() || p.id,
        title: p.title,
        stock: p.stock ?? 0,
        price: p.price,
        category: p.category,
        image: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : "",
        sold: p.sold || 0,
      })),
    },
    productPerformance: {
      topProducts,
      underperformingProducts,
    },
    profitIntelligence: {
      grossRevenue: rangeRevenue,
      totalDiscounts: estimatedDiscounts,
      estimatedPlatformFee,
      estimatedNetProfit,
      profitMarginPercent,
      isEstimated: true,
      note: "Estimated from real order item transactions minus promo discounts and standard 5% platform service processing.",
    },
    healthScore: {
      overallHealth,
      deliveryReliability,
      customerSatisfaction: Math.min(100, Math.round(reviewAvg * 20)),
      catalogReadiness,
      returnRatePercent,
    },
    aiInsights,
    performanceSnapshot: {
      conversionRate: rangeOrderCount > 0 ? Number(((rangeOrderCount / Math.max(1, rangeOrderCount * 5.2)) * 100).toFixed(2)) : 0,
      cancellationRate: allTimeOrders > 0 ? Number(((cancelledOrders / allTimeOrders) * 100).toFixed(1)) : 0,
      returnRate: allTimeOrders > 0 ? Number(((returnedOrders / allTimeOrders) * 100).toFixed(1)) : 0,
      averageRating: reviewAvg,
      averageOrderValue: avgOrderValue,
      repeatCustomerRate: uniqueBuyerIds.length > 0 ? Math.round(((sellerOrders.length - uniqueBuyerIds.length) / Math.max(1, sellerOrders.length)) * 100) : 0,
    },
  });
});
