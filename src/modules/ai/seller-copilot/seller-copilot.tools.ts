import mongoose from "mongoose";
import { Store } from "../../sellers/store.model";
import { Product } from "../../products/product.model";
import { Order } from "../../orders/order.model";
import { Review } from "../../reviews/review.model";
import { Coupon } from "../../coupons/coupon.model";
import { getSellerContext, getSellerStore } from "../../sellers/seller-store.util";

const db = () => mongoose.connection.db;

async function requireSellerStore(userId: string) {
  const store = await getSellerStore(userId);
  if (!store) {
    throw new Error("No store found for this seller. Please create a store first.");
  }
  return store;
}

export interface SellerOverview {
  storeName: string;
  trustScore: number;
  storeRating: number;
  status: string;
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  deliveredOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  avgOrderValue: number;
}

export interface SellerRevenue {
  totalRevenue: number;
  previousRevenue?: number;
  revenueChangePercent?: number;
  avgOrderValue: number;
  discountAmount: number;
  refundAmount: number;
  cancelledValue: number;
}

export interface ProductPerformance {
  id: string;
  title: string;
  category: string;
  price: number;
  discountPrice?: number;
  stock: number;
  sold: number;
  revenue: number;
  ratingAvg: number;
  ratingCount: number;
  status: string;
}

export interface CategoryPerformance {
  name: string;
  revenue: number;
  orders: number;
  units: number;
  sharePercent: number;
}

export interface CustomerInsight {
  buyerId: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date;
}

export interface ReviewSummary {
  total: number;
  avgRating: number;
  positiveCount: number;
  negativeCount: number;
  recent: Array<{ rating: number; comment: string; at: Date; productTitle: string }>;
}

export interface ReturnAnalytics {
  totalReturned: number;
  returnRatePercent: number;
  returnedValue: number;
  refundedValue: number;
  byProduct: Array<{ productId: string; title: string; returnCount: number }>;
}

export async function getSellerOverview(userId: string): Promise<SellerOverview> {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const { totalRevenue, totalOrders, deliveredOrders, pendingOrders, returnedOrders, cancelledOrders } = await getSellerContext(userId);
  const products = await Product.find({ $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store.id }], isDeleted: false });
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  return {
    storeName: store.storeName,
    trustScore: store.trustScore,
    storeRating: store.rating,
    status: store.status,
    totalProducts: products.length,
    totalOrders,
    totalRevenue,
    deliveredOrders,
    pendingOrders,
    cancelledOrders,
    returnedOrders,
    avgOrderValue,
  };
}

export async function getStoreData(userId: string) {
  const store = await requireSellerStore(userId);
  return {
    id: store._id?.toString(),
    storeName: store.storeName,
    slug: store.slug,
    description: store.description,
    status: store.status,
    trustScore: store.trustScore,
    rating: store.rating,
    ratingCount: store.ratingCount,
    followersCount: store.followersCount,
    logo: store.logo,
    banner: store.banner,
  };
}

export async function getSellerRevenue(userId: string, startDate: Date, endDate: Date): Promise<SellerRevenue> {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const periodMs = endDate.getTime() - startDate.getTime();
  const previousStart = new Date(startDate.getTime() - periodMs);
  const previousEnd = new Date(endDate.getTime() - periodMs);

  const computeRevenue = async (from: Date, to: Date) => {
    const orders = await Order.find({
      createdAt: { $gte: from, $lte: to },
      status: { $in: ["delivered", "shipped", "out_for_delivery"] },
      $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }],
    }).lean();
    let revenue = 0;
    let ordersCount = 0;
    const discounts = 0;
    for (const order of orders) {
      let sellerSubtotal = 0;
      for (const item of order.items || []) {
        if (item.sellerId === userId || item.storeId === storeIdStr) {
          sellerSubtotal += (item.price || 0) * (item.quantity || 1);
        }
      }
      if (sellerSubtotal > 0) {
        revenue += sellerSubtotal;
        ordersCount += 1;
      }
    }
    return { revenue, orders: ordersCount, discounts: 0 };
  };

  const [current, previous] = await Promise.all([computeRevenue(startDate, endDate), computeRevenue(previousStart, previousEnd)]);

  const [refunds, cancellations] = await Promise.all([
    Order.find({
      $and: [
        { $or: [{ status: "refunded" }, { paymentStatus: "refunded" }] },
        { createdAt: { $gte: startDate, $lte: endDate } },
        { $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }] },
      ],
    }).lean(),
    Order.find({
      status: "cancelled",
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }],
    }).lean(),
  ]);

  let refundAmount = 0;
  for (const order of refunds) {
    for (const item of order.items || []) {
      if (item.sellerId === userId || item.storeId === storeIdStr) {
        refundAmount += (item.price || 0) * (item.quantity || 1);
      }
    }
  }

  let cancelledValue = 0;
  for (const order of cancellations) {
    for (const item of order.items || []) {
      if (item.sellerId === userId || item.storeId === storeIdStr) {
        cancelledValue += (item.price || 0) * (item.quantity || 1);
      }
    }
  }

  const totalRevenue = current.revenue;
  const previousRevenue = previous.revenue;
  const revenueChangePercent = previousRevenue > 0 ? Math.round(((totalRevenue - previousRevenue) / previousRevenue) * 1000) / 10 : undefined;

  return {
    totalRevenue,
    previousRevenue: previousRevenue || undefined,
    revenueChangePercent,
    avgOrderValue: current.orders > 0 ? Math.round(totalRevenue / current.orders) : 0,
    discountAmount: current.discounts || 0,
    refundAmount,
    cancelledValue,
  };
}

export async function getSellerOrders(userId: string, startDate?: Date, endDate?: Date) {
  const store = await requireSellerStore(userId);
  const filter: Record<string, unknown> = {
    $or: [
      { "items.sellerId": userId },
      { "items.storeId": store._id },
    ],
  };
  if (startDate && endDate) {
    filter.createdAt = { $gte: startDate, $lte: endDate };
  }
  return await Order.find(filter).sort({ createdAt: -1 }).lean();
}

export async function getPendingOrders(userId: string) {
  const orders = await getSellerOrders(userId);
  return orders.filter((o: any) => ["pending", "confirmed", "processing"].includes(o.status));
}

export async function getCompletedOrders(userId: string, startDate?: Date, endDate?: Date) {
  const orders = await getSellerOrders(userId, startDate, endDate);
  return orders.filter((o: any) => o.status === "delivered");
}

export async function getCancelledOrders(userId: string, startDate?: Date, endDate?: Date) {
  const orders = await getSellerOrders(userId, startDate, endDate);
  return orders.filter((o: any) => o.status === "cancelled");
}

export async function getReturnedOrders(userId: string, startDate?: Date, endDate?: Date) {
  const orders = await getSellerOrders(userId, startDate, endDate);
  return orders.filter((o: any) => ["returned", "refunded"].includes(o.status));
}

export async function getSellerProducts(userId: string): Promise<ProductPerformance[]> {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const products = await Product.find({ $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store.id }], isDeleted: false }).lean();
  const orders = await getSellerOrders(userId);
  const salesMap = new Map<string, { sold: number; revenue: number }>();
  orders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.sellerId === userId || it.storeId === storeIdStr || it.storeId === store.id) {
        const existing = salesMap.get(it.productId) || { sold: 0, revenue: 0 };
        existing.sold += it.quantity || 1;
        existing.revenue += (it.price || 0) * (it.quantity || 1);
        salesMap.set(it.productId, existing);
      }
    });
  });
  return products.map((p: any) => {
    const sales = salesMap.get(p._id?.toString() || p.id) || { sold: p.sold || 0, revenue: (p.sold || 0) * (p.price || 0) };
    return {
      id: p._id?.toString() || "",
      title: p.title,
      category: p.category || "General",
      price: p.price,
      discountPrice: p.discountPrice,
      stock: p.stock || 0,
      sold: sales.sold,
      revenue: sales.revenue,
      ratingAvg: p.ratingAvg || 0,
      ratingCount: p.ratingCount || 0,
      status: p.status || "approved",
    };
  });
}

export async function getTopProducts(userId: string, limit = 5): Promise<ProductPerformance[]> {
  const products = await getSellerProducts(userId);
  return products.filter((p) => p.sold > 0).sort((a, b) => b.revenue - a.revenue || b.sold - a.sold).slice(0, limit);
}

export async function getLowPerformingProducts(userId: string): Promise<ProductPerformance[]> {
  const products = await getSellerProducts(userId);
  return products.filter((p) => p.stock > 0 && p.sold <= 1).sort((a, b) => a.sold - b.sold || b.stock - a.stock).slice(0, 10);
}

export async function getLowStockProducts(userId: string): Promise<ProductPerformance[]> {
  const products = await getSellerProducts(userId);
  return products.filter((p) => p.stock > 0 && p.stock <= 10).sort((a, b) => a.stock - b.stock).slice(0, 10);
}

export async function getOutOfStockProducts(userId: string): Promise<ProductPerformance[]> {
  const products = await getSellerProducts(userId);
  return products.filter((p) => p.stock === 0).slice(0, 10);
}

export async function getInventoryData(userId: string) {
  const products = await getSellerProducts(userId);
  const totalProducts = products.length;
  const healthyStock = products.filter((p) => p.stock > 10).length;
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= 10).length;
  const outOfStock = products.filter((p) => p.stock === 0).length;
  const totalStockUnits = products.reduce((sum, p) => sum + p.stock, 0);
  return {
    totalProducts,
    healthyStock,
    lowStock,
    outOfStock,
    totalStockUnits,
    products,
  };
}

export async function getProductPerformance(userId: string, productId: string) {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const product = await Product.findOne({ _id: productId, $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store.id }], isDeleted: false }).lean();
  if (!product) return null;
  const orders = await getSellerOrders(userId);
  let revenue = 0;
  let unitsSold = 0;
  orders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.productId === productId) {
        unitsSold += it.quantity || 1;
        revenue += (it.price || 0) * (it.quantity || 1);
      }
    });
  });
  return {
    id: product._id?.toString() || "",
    title: product.title,
    category: product.category,
    price: product.price,
    discountPrice: product.discountPrice,
    stock: product.stock || 0,
    sold: unitsSold,
    revenue,
    ratingAvg: product.ratingAvg || 0,
    ratingCount: product.ratingCount || 0,
    status: product.status,
    views: product.views || 0,
  };
}

export async function getProductSales(userId: string, productId: string) {
  const perf = await getProductPerformance(userId, productId);
  if (!perf) return null;
  return { productId, ...perf };
}

export async function getProductRevenue(userId: string, productId: string) {
  const perf = await getProductPerformance(userId, productId);
  if (!perf) return null;
  return { productId, title: perf.title, revenue: perf.revenue, sold: perf.sold };
}

export async function getCategoryPerformance(userId: string, startDate?: Date, endDate?: Date): Promise<CategoryPerformance[]> {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const products = await Product.find({ $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store.id }], isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p.category || "General"]));
  const orders = await getSellerOrders(userId, startDate, endDate);
  const catMap = new Map<string, { revenue: number; orders: number; units: number }>();
  orders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.sellerId === userId || it.storeId === storeIdStr || it.storeId === store.id) {
        const cat = productMap.get(it.productId) || "General";
        const existing = catMap.get(cat) || { revenue: 0, orders: 0, units: 0 };
        existing.revenue += (it.price || 0) * (it.quantity || 1);
        existing.orders += 1;
        existing.units += it.quantity || 1;
        catMap.set(cat, existing);
      }
    });
  });
  let totalRevenue = 0;
  catMap.forEach((v) => { totalRevenue += v.revenue; });
  return Array.from(catMap.entries()).map(([name, data]) => ({
    name,
    revenue: data.revenue,
    orders: data.orders,
    units: data.units,
    sharePercent: totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 1000) / 10 : 0,
  })).sort((a, b) => b.revenue - a.revenue);
}

export async function getCustomerData(userId: string): Promise<CustomerInsight[]> {
  const orders = await getSellerOrders(userId);
  const buyerMap = new Map<string, { orderCount: number; totalSpent: number; lastOrderAt: Date }>();
  orders.forEach((o: any) => {
    const existing = buyerMap.get(o.userId) || { orderCount: 0, totalSpent: 0, lastOrderAt: new Date(0) };
    existing.orderCount += 1;
    existing.totalSpent += o.totalAmount || 0;
    if (new Date(o.createdAt) > new Date(existing.lastOrderAt)) {
      existing.lastOrderAt = new Date(o.createdAt);
    }
    buyerMap.set(o.userId, existing);
  });
  return Array.from(buyerMap.entries()).map(([buyerId, data]) => ({
    buyerId,
    ...data,
  })).sort((a, b) => b.totalSpent - a.totalSpent);
}

export async function getCustomerReviews(userId: string, limit = 20) {
  const products = await getSellerProducts(userId);
  const productIds = products.map((p) => p.id).filter(Boolean);
  if (productIds.length === 0) return { total: 0, avgRating: 0, positiveCount: 0, negativeCount: 0, recent: [] } as ReviewSummary;
  const reviews = await Review.find({ productId: { $in: productIds } }).sort({ createdAt: -1 }).limit(limit).lean();
  const recent = reviews.slice(0, 10).map((r: any) => ({
    rating: r.rating,
    comment: r.comment,
    at: r.createdAt,
    productTitle: products.find((p) => p.id === r.productId)?.title || "Unknown Product",
  }));
  const avgRating = reviews.length > 0 ? Number((reviews.reduce((sum: number, r: any) => sum + (r.rating || 5), 0) / reviews.length).toFixed(1)) : 0;
  const positiveCount = reviews.filter((r: any) => r.rating >= 4).length;
  const negativeCount = reviews.filter((r: any) => r.rating <= 2).length;
  return {
    total: reviews.length,
    avgRating,
    positiveCount,
    negativeCount,
    recent,
  };
}

export async function getReturnAnalytics(userId: string, startDate?: Date, endDate?: Date): Promise<ReturnAnalytics> {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const orders = await getSellerOrders(userId, startDate, endDate);
  const returned = orders.filter((o: any) => ["returned", "refunded"].includes(o.status));
  const totalReturned = returned.length;
  let returnedValue = 0;
  for (const order of returned) {
    for (const item of order.items || []) {
      if (item.sellerId === userId || item.storeId === storeIdStr) {
        returnedValue += (item.price || 0) * (item.quantity || 1);
      }
    }
  }
  const refunded = orders.filter((o: any) => o.paymentStatus === "refunded");
  let refundedValue = 0;
  for (const order of refunded) {
    for (const item of order.items || []) {
      if (item.sellerId === userId || item.storeId === storeIdStr) {
        refundedValue += (item.price || 0) * (item.quantity || 1);
      }
    }
  }
  const returnRatePercent = orders.length > 0 ? Math.round((totalReturned / orders.length) * 1000) / 10 : 0;
  const byProductMap = new Map<string, { title: string; returnCount: number }>();
  returned.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.sellerId === userId || it.storeId === storeIdStr) {
        const existing = byProductMap.get(it.productId) || { title: it.title, returnCount: 0 };
        existing.returnCount += 1;
        byProductMap.set(it.productId, existing);
      }
    });
  });
  return {
    totalReturned,
    returnRatePercent,
    returnedValue,
    refundedValue,
    byProduct: Array.from(byProductMap.entries()).map(([productId, data]) => ({ productId, ...data })).sort((a, b) => b.returnCount - a.returnCount).slice(0, 10),
  };
}

export async function getCouponPerformance(userId: string) {
  const coupons = await Coupon.find({ createdBy: userId, isActive: true });
  return coupons.map((c: any) => ({
    id: c._id?.toString() || "",
    code: c.code,
    type: c.type,
    value: c.value,
    usedCount: c.usedCount || 0,
    usageLimit: c.usageLimit,
  }));
}

export async function getRecentActivity(userId: string, limit = 10) {
  const orders = await getSellerOrders(userId);
  return orders.slice(0, limit).map((o: any) => ({
    id: o._id?.toString() || "",
    status: o.status,
    totalAmount: o.totalAmount,
    createdAt: o.createdAt,
    itemCount: (o.items || []).length,
  }));
}

export async function getStoreAnalytics(userId: string, startDate: Date, endDate: Date) {
  const orders = await getSellerOrders(userId, startDate, endDate);
  const currentRevenue = orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? Math.round(currentRevenue / orderCount) : 0;
  return {
    period: { start: startDate.toISOString(), end: endDate.toISOString() },
    totalRevenue: currentRevenue,
    orderCount,
    avgOrderValue,
  };
}

export async function getConversionData(userId: string) {
  const orders = await getSellerOrders(userId);
  const total = orders.length;
  const delivered = orders.filter((o: any) => o.status === "delivered").length;
  const cancelled = orders.filter((o: any) => o.status === "cancelled").length;
  const conversionRate = total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0;
  const cancellationRate = total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0;
  return {
    totalOrders: total,
    delivered,
    cancelled,
    conversionRate,
    cancellationRate,
  };
}

export async function getSellerSalesDropAnalysis(userId: string, currentStart: Date, currentEnd: Date) {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const periodMs = currentEnd.getTime() - currentStart.getTime();
  const previousStart = new Date(currentStart.getTime() - periodMs);
  const previousEnd = new Date(currentStart.getTime() - 1);

  const [currentOrders, previousOrders] = await Promise.all([
    Order.find({ createdAt: { $gte: currentStart, $lte: currentEnd }, $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }, { "items.storeId": store.id }] }).lean(),
    Order.find({ createdAt: { $gte: previousStart, $lte: previousEnd }, $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }, { "items.storeId": store.id }] }).lean(),
  ]);

  const currentRevenue = currentOrders.reduce((sum, o: any) => sum + (o.totalAmount || 0), 0);
  const previousRevenue = previousOrders.reduce((sum, o: any) => sum + (o.totalAmount || 0), 0);
  const revenueChange = previousRevenue > 0 ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 1000) / 10 : 0;

  const currentProductMap = new Map<string, { revenue: number; sold: number }>();
  currentOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.sellerId === userId || it.storeId === storeIdStr || it.storeId === store.id) {
        const existing = currentProductMap.get(it.productId) || { revenue: 0, sold: 0 };
        existing.revenue += (it.price || 0) * (it.quantity || 1);
        existing.sold += it.quantity || 1;
        currentProductMap.set(it.productId, existing);
      }
    });
  });

  const previousProductMap = new Map<string, { revenue: number; sold: number }>();
  previousOrders.forEach((o: any) => {
    (o.items || []).forEach((it: any) => {
      if (it.sellerId === userId || it.storeId === storeIdStr || it.storeId === store.id) {
        const existing = previousProductMap.get(it.productId) || { revenue: 0, sold: 0 };
        existing.revenue += (it.price || 0) * (it.quantity || 1);
        existing.sold += it.quantity || 1;
        previousProductMap.set(it.productId, existing);
      }
    });
  });

  const products = await Product.find({ $or: [{ sellerId: userId }, { storeId: storeIdStr }, { storeId: store.id }], isDeleted: false }).lean();
  const productMap = new Map(products.map((p: any) => [p._id?.toString() || p.id, p]));

  const decliningProducts: Array<{ title: string; currentRevenue: number; previousRevenue: number; changePercent: number }> = [];
  for (const [pid, curr] of currentProductMap.entries()) {
    const prev = previousProductMap.get(pid);
    if (prev && prev.revenue > 0) {
      const change = Math.round(((curr.revenue - prev.revenue) / prev.revenue) * 1000) / 10;
      if (change < -10) {
        const product = productMap.get(pid);
        decliningProducts.push({
          title: product?.title || pid,
          currentRevenue: curr.revenue,
          previousRevenue: prev.revenue,
          changePercent: change,
        });
      }
    }
  }

  const outOfStockDuringPeriod = products.filter((p: any) => p.stock === 0).map((p: any) => ({ title: p.title, stock: 0 }));

  return {
    currentPeriod: { start: currentStart, end: currentEnd, revenue: currentRevenue, orders: currentOrders.length },
    previousPeriod: { start: previousStart, end: previousEnd, revenue: previousRevenue, orders: previousOrders.length },
    revenueChangePercent: revenueChange,
    orderChangePercent: previousOrders.length > 0 ? Math.round(((currentOrders.length - previousOrders.length) / previousOrders.length) * 1000) / 10 : 0,
    avgOrderValue: currentOrders.length > 0 ? Math.round(currentRevenue / currentOrders.length) : 0,
    decliningProducts: decliningProducts.sort((a, b) => a.changePercent - b.changePercent).slice(0, 5),
    outOfStockProducts: outOfStockDuringPeriod.slice(0, 5),
    confidence: currentOrders.length >= 5 ? "high" : currentOrders.length >= 2 ? "medium" : "low",
  };
}

export async function getSellerForecast(userId: string, forecastDays = 30) {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const now = new Date();
  const startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const orders = await Order.find({ createdAt: { $gte: startDate, $lte: now }, $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }, { "items.storeId": store.id }] }).lean();

  if (orders.length < 3) {
    return {
      forecastRevenue: 0,
      forecastOrders: 0,
      confidence: "insufficient",
      method: "insufficient_data",
      dataWindow: "last_90_days",
      message: "Insufficient historical data for a reliable forecast.",
    };
  }

  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last30Orders = orders.filter((o: any) => o.createdAt >= last30Start);
  const last30Revenue = last30Orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

  const prev30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const prev30End = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prev30Orders = orders.filter((o: any) => o.createdAt >= prev30Start && o.createdAt <= prev30End);
  const prev30Revenue = prev30Orders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);

  const trend = prev30Revenue > 0 ? Math.round(((last30Revenue - prev30Revenue) / prev30Revenue) * 1000) / 10 : 0;
  const dailyAvg = last30Orders.length / 30;
  const revenueDailyAvg = last30Revenue / 30;

  const forecastOrders = Math.round(dailyAvg * forecastDays);
  const forecastRevenue = Math.round(revenueDailyAvg * forecastDays);

  const confidence = orders.length >= 20 ? "high" : orders.length >= 10 ? "medium" : "low";

  return {
    forecastRevenue,
    forecastOrders,
    confidence,
    baseline: Math.round(prev30Revenue),
    trend,
    method: "30_day_velocity",
    dataWindow: "last_90_days",
    risks: confidence === "low" ? "Limited order history; forecast may be unreliable." : "Based on recent order velocity.",
  };
}

export async function getTodaysBusinessBrief(userId: string) {
  const store = await requireSellerStore(userId);
  const storeIdStr = store._id?.toString() || store.id;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [overview, todayOrders, recentOrders, lowStock, outOfStock, lowPerf, recentReviews] = await Promise.all([
    getSellerOverview(userId),
    Order.find({ createdAt: { $gte: todayStart, $lte: now }, $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }, { "items.storeId": store.id }] }).lean(),
    Order.find({ createdAt: { $gte: thirtyDaysAgo, $lte: now }, $or: [{ "items.sellerId": userId }, { "items.storeId": storeIdStr }, { "items.storeId": store.id }] }).sort({ createdAt: -1 }).limit(5).lean(),
    getLowStockProducts(userId),
    getOutOfStockProducts(userId),
    getLowPerformingProducts(userId),
    getCustomerReviews(userId, 5),
  ]);

  const todayRevenue = todayOrders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
  const topProduct = overview.totalProducts > 0 ? await getTopProducts(userId, 1) : [];

  return {
    date: todayStart.toISOString().split("T")[0],
    revenue: todayRevenue,
    orders: todayOrders.length,
    topProduct: topProduct[0] || null,
    lowStock: lowStock.slice(0, 5),
    outOfStock: outOfStock.slice(0, 5),
    decliningProducts: lowPerf.slice(0, 5),
    recentSentiment: recentReviews.recent.slice(0, 3),
    storeName: overview.storeName,
  };
}
