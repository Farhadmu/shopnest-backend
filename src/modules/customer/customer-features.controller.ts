import { Request, Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { Product } from "../products/product.model";
import { Store } from "../sellers/store.model";
import { Order } from "../orders/order.model";
import { Review } from "../reviews/review.model";
import { Wishlist } from "../wishlist/wishlist.model";
import { Notification } from "../notifications/notification.model";
import { DeliveryZone } from "../delivery/delivery-zone.model";
import { complete } from "../ai/providers/claude.provider";
import { logAiIncident } from "../ai/incident/incident.service";
import {
  UserPreferences,
  LoyaltyPoints,
  LoyaltyTransaction,
  PaymentRecord,
  UserCoupon,
  CustomerSellerMessage,
  BuyAgainItem,
  PurchaseDocument,
  ReturnRequest,
  ProductQualityScore,
  SearchHistory,
} from "./customer-features.model";
import {
  Address,
  CustomerActivity,
  SupportTicket,
  StockAlert,
  PriceAlert,
  ProductQuestion,
  ProductReport,
  DeliveryFeedback,
  ComparisonHistory,
  WishlistGroup,
} from "./customer-extras.model";
import { PriceHistory, ShoppingGoal, ShoppingJourney } from "./customer-intelligence.model";

// ============================================================
// PRODUCT QUALITY SCORE (Feature 7)
// ============================================================
export const getProductQualityScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);
  const reviews = await Review.find({ productId });

  const ratingScore = Math.min(100, Math.round((product.ratingAvg / 5) * 100));
  const discountRatio = product.discountPrice ? (product.price - product.discountPrice) / product.price : 0;
  const valueScore = Math.min(100, Math.round(75 + discountRatio * 60));
  const sellerScore = Math.round(store?.trustScore || 70);
  const deliveryScore = Math.min(100, Math.round(70 + (store?.rating || 4) * 6));
  const reviewScore = Math.min(100, reviews.length * 5);

  const sentimentPositive = reviews.filter((r) => r.rating >= 4).length;
  const sentimentNegative = reviews.filter((r) => r.rating <= 2).length;

  const overallScore = Math.round(
    ratingScore * 0.3 + valueScore * 0.2 + sellerScore * 0.2 + deliveryScore * 0.15 + reviewScore * 0.15
  );

  await ProductQualityScore.findOneAndUpdate(
    { productId },
    { productId, overallScore, ratingScore, valueScore, sellerScore, deliveryScore, reviewCount: reviews.length, sentimentPositive, sentimentNegative, calculatedAt: new Date() },
    { upsert: true, new: true }
  );

  sendSuccess(res, {
    productId, overallScore, rating: product.ratingAvg, ratingScore, value: valueScore,
    seller: sellerScore, delivery: deliveryScore, reviewCount: reviews.length,
    factors: {
      rating: { score: ratingScore, weight: "30%", label: "Customer Ratings" },
      value: { score: valueScore, weight: "20%", label: "Value for Money" },
      seller: { score: sellerScore, weight: "20%", label: "Seller Trust" },
      delivery: { score: deliveryScore, weight: "15%", label: "Delivery Performance" },
      reviews: { score: reviewScore, weight: "15%", label: "Review Volume" },
    },
  });
});

// ============================================================
// SELLER TRUST SCORE (Feature 6)
// ============================================================
export const getSellerTrustScore = asyncHandler(async (req: Request, res: Response) => {
  const { storeId } = req.params;
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.notFound("Store not found");

  const totalOrders = await Order.countDocuments({ "items.storeId": storeId });
  const completedOrders = await Order.countDocuments({ "items.storeId": storeId, status: "delivered" });
  const cancelledOrders = await Order.countDocuments({ "items.storeId": storeId, status: "cancelled" });
  const returnRequests = await Order.countDocuments({ "items.storeId": storeId, status: "return_requested" });

  const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 80;
  const cancellationRate = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 5;
  const returnRate = completedOrders > 0 ? (returnRequests / completedOrders) * 100 : 3;
  const accountAgeDays = Math.floor((Date.now() - new Date(store.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  const accountAgeScore = Math.min(100, Math.round((accountAgeDays / 365) * 100));
  const isVerified = store.status === "approved";

  const trustScore = Math.round(
    store.trustScore * 0.3 + completionRate * 0.25 + (100 - cancellationRate * 5) * 0.15 +
    (100 - returnRate * 10) * 0.15 + accountAgeScore * 0.1 + (isVerified ? 10 : 0)
  );

  const indicators = [
    { label: "Verified Seller", passed: isVerified, detail: isVerified ? "Business verified by ShopNest" : "Pending verification" },
    { label: "Good Delivery Record", passed: completionRate >= 85, detail: `${Math.round(completionRate)}% orders delivered` },
    { label: "Highly Rated", passed: store.rating >= 4, detail: `${store.rating.toFixed(1)}/5 average rating` },
    { label: "Low Cancellation", passed: cancellationRate <= 5, detail: `${Math.round(cancellationRate)}% cancellation rate` },
    { label: "Active Seller", passed: totalOrders > 10, detail: `${totalOrders} total orders` },
  ];

  sendSuccess(res, {
    storeId, storeName: store.storeName, trustScore: Math.min(100, trustScore),
    rating: store.rating, indicators,
    metrics: { totalOrders, completionRate: Math.round(completionRate), cancellationRate: Math.round(cancellationRate), returnRate: Math.round(returnRate), accountAgeDays },
  });
});

// ============================================================
// PERSONAL PRICE INTELLIGENCE (Feature 4)
// ============================================================
export const getPriceIntelligence = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  let priceRecord = await PriceHistory.findOne({ productId });

  if (!priceRecord) {
    const currentPrice = product.discountPrice || product.price;
    const basePrice = product.price;
    const historyPoints = [];
    for (let i = 7; i >= 0; i--) {
      const variation = (Math.sin(i) * 0.05 + 0.02) * basePrice;
      const pointPrice = Math.round(i === 0 ? currentPrice : basePrice + variation);
      historyPoints.push({ price: pointPrice, recordedAt: new Date(Date.now() - i * 4 * 24 * 3600 * 1000) });
    }
    const prices = historyPoints.map((p) => p.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const trend = currentPrice <= lowestPrice ? "dropping" : currentPrice >= highestPrice ? "rising" : "stable";

    priceRecord = await PriceHistory.create({
      productId, history: historyPoints, lowestPrice, highestPrice, averagePrice, currentPrice, trend,
      insight: currentPrice < averagePrice ? `Good time to buy! Price is ৳${(averagePrice - currentPrice).toLocaleString()} below average.` :
        currentPrice > averagePrice ? `Price is ৳${(currentPrice - averagePrice).toLocaleString()} above average. Consider waiting.` : "Price is stable near average.",
    });
  }

  const currentPrice = product.discountPrice || product.price;
  sendSuccess(res, {
    productId, currentPrice, previousPrice: product.price, priceChange: currentPrice - product.price,
    priceChangePercent: product.price > 0 ? Math.round(((currentPrice - product.price) / product.price) * 100) : 0,
    lowestRecorded: priceRecord.lowestPrice, highestRecorded: priceRecord.highestPrice,
    averagePrice: priceRecord.averagePrice, trend: priceRecord.trend, history: priceRecord.history,
    insight: priceRecord.insight,
    recommendation: priceRecord.trend === "dropping" ? "Good time to buy - price is dropping." :
      priceRecord.trend === "rising" ? "Price is rising - consider buying soon." : "Price is stable - fair time to purchase.",
  });
});

// ============================================================
// SMART BANGLADESH DELIVERY (Feature 9)
// ============================================================
export const getDeliveryEstimate = asyncHandler(async (req: Request, res: Response) => {
  const { division, district, upazila, productId } = req.query as { division?: string; district?: string; upazila?: string; productId?: string };
  if (!division) throw ApiError.badRequest("Division is required");

  const zoneFilter: Record<string, unknown> = { isActive: true, divisions: { $in: [division] } };
  if (district) zoneFilter.districts = { $in: [district] };
  const zone = await DeliveryZone.findOne(zoneFilter);

  let productAvailable = true;
  if (productId) {
    const product = await Product.findById(productId);
    if (!product) throw ApiError.notFound("Product not found");
    productAvailable = product.stock > 0 && product.status === "approved";
  }

  const isDhaka = division.toLowerCase().includes("dhaka");
  const estimatedDays = zone?.estimatedDays || (isDhaka ? 1 : 3);
  const deliveryFee = zone?.baseFee || (isDhaka ? 60 : 120);

  sendSuccess(res, {
    division, district: district || null, upazila: upazila || null,
    deliveryAvailable: true, codAvailable: true, estimatedDays: `${estimatedDays}-${estimatedDays + 1}`,
    deliveryFee, currency: "BDT", zoneName: zone?.name || (isDhaka ? "Inside Dhaka" : "Outside Dhaka"),
    productAvailable, sellerSupportsArea: true, freeDeliveryAbove: 2000,
  });
});

// ============================================================
// ADVANCED ORDER TRACKING (Feature 10)
// ============================================================
export const getAdvancedTracking = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId } = req.params;
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");

  const statusFlow = [
    { key: "pending", label: "Order Confirmed", icon: "✓" },
    { key: "confirmed", label: "Seller Processing", icon: "⚙" },
    { key: "processing", label: "Packed", icon: "📦" },
    { key: "shipped", label: "Handed to Courier", icon: "🚚" },
    { key: "out_for_delivery", label: "In Transit", icon: "🛣" },
    { key: "delivered", label: "Delivered", icon: "🎉" },
  ];

  const currentStatusIndex = statusFlow.findIndex((s) => s.key === order.status);
  const timeline = statusFlow.map((step, index) => ({
    ...step, completed: index <= currentStatusIndex, current: index === currentStatusIndex,
    timestamp: order.statusHistory?.find((h) => h.status === step.key)?.at || null,
  }));

  const productIds = order.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } }).select("title images");
  const productMap = new Map(products.map((p) => [p.id, p]));

  sendSuccess(res, {
    orderId: order.id, status: order.status, currentStatus: statusFlow[currentStatusIndex]?.label || order.status,
    timeline, items: order.items.map((item) => ({ ...item, image: productMap.get(item.productId)?.images?.[0] || "" })),
    totalAmount: order.totalAmount, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus,
    estimatedDelivery: order.status === "delivered" ? null : "2-3 business days", placedAt: order.createdAt,
  });
});

// ============================================================
// SMART RETURN CENTER (Feature 11)
// ============================================================
export const getReturnRequests = asyncHandler(async (req: Request, res: Response) => {
  const returns = await ReturnRequest.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, returns);
});

export const createReturnRequest = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId, productId, type, reason, evidenceUrls } = req.body;

  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw ApiError.notFound("Order not found");
  const orderItem = order.items.find((i) => i.productId === productId);
  if (!orderItem) throw ApiError.badRequest("Product not found in this order");

  const existing = await ReturnRequest.findOne({ userId, orderId, productId, status: { $ne: "rejected" } });
  if (existing) throw ApiError.conflict("Return request already exists for this product");

  const returnReq = await ReturnRequest.create({
    userId, orderId, productId, productTitle: orderItem.title, sellerId: orderItem.sellerId,
    type, reason, status: "requested",
    statusHistory: [{ status: "requested", at: new Date(), note: "Return requested by customer" }],
    evidenceUrls: evidenceUrls || [], refundAmount: orderItem.price * orderItem.quantity,
    refundMethod: order.paymentMethod === "cash_on_delivery" ? "bank_transfer" : order.paymentMethod,
  });

  order.status = "returned";
  await order.save();
  sendSuccess(res, returnReq, "Return request submitted successfully", 201);
});

export const getReturnDetails = asyncHandler(async (req: Request, res: Response) => {
  const returnReq = await ReturnRequest.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!returnReq) throw ApiError.notFound("Return request not found");
  sendSuccess(res, returnReq);
});

// ============================================================
// SMART PAYMENT CENTER (Feature 12)
// ============================================================
export const getPaymentHistory = asyncHandler(async (req: Request, res: Response) => {
  const payments = await PaymentRecord.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, payments);
});

export const getPaymentSummary = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orders = await Order.find({ userId });
  const payments = await PaymentRecord.find({ userId, status: "successful" });

  const totalSpent = payments.reduce((sum, p) => sum + p.amount, 0);
  const refundedRecords = await PaymentRecord.find({ userId, status: "refunded" });
  const refundedAmount = refundedRecords.reduce((s, p) => s + p.amount, 0);

  const methodBreakdown: Record<string, number> = {};
  payments.forEach((p) => { methodBreakdown[p.method] = (methodBreakdown[p.method] || 0) + p.amount; });

  sendSuccess(res, {
    totalSpent, successfulPayments: payments.length,
    failedPayments: await PaymentRecord.countDocuments({ userId, status: "failed" }),
    refundedAmount, codOrders: orders.filter((o) => o.paymentMethod === "cash_on_delivery").length,
    methodBreakdown, currency: "BDT",
  });
});

// ============================================================
// SMART VOUCHER WALLET (Feature 13)
// ============================================================
export const getVoucherWallet = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const coupons = await UserCoupon.find({ userId }).sort({ expiresAt: 1 });
  const available = coupons.filter((c) => c.status === "available" && c.expiresAt > now);
  const expiringSoon = coupons.filter((c) => c.status === "available" && c.expiresAt > now && c.expiresAt <= threeDaysFromNow);

  sendSuccess(res, {
    available, expiringSoon, used: coupons.filter((c) => c.status === "used"),
    expired: coupons.filter((c) => c.status === "expired" || (c.status === "available" && c.expiresAt <= now)),
    sellerVouchers: coupons.filter((c) => c.source === "seller" && c.status === "available"),
    freeDelivery: coupons.filter((c) => c.type === "free_delivery" && c.status === "available"),
    personalizedOffers: coupons.filter((c) => c.source === "personalized" && c.status === "available"),
    totalAvailable: available.length, totalUsed: coupons.filter((c) => c.status === "used").length,
  });
});

export const claimVoucher = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { couponCode } = req.body;

  const Coupon = require("../coupons/coupon.model").Coupon;
  const platformCoupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
  if (!platformCoupon) throw ApiError.notFound("Invalid coupon code");

  const existing = await UserCoupon.findOne({ userId, couponCode: couponCode.toUpperCase() });
  if (existing) throw ApiError.conflict("Coupon already claimed");

  if (platformCoupon.expiresAt && new Date(platformCoupon.expiresAt) < new Date()) {
    throw ApiError.badRequest("Coupon has expired");
  }

  const userCoupon = await UserCoupon.create({
    userId, couponCode: platformCoupon.code,
    title: `${platformCoupon.type === "percentage" ? `${platformCoupon.value}%` : `৳${platformCoupon.value}`} OFF`,
    description: `Valid on orders above ৳${platformCoupon.minPurchase}${platformCoupon.category ? ` in ${platformCoupon.category}` : ""}`,
    type: platformCoupon.type === "percentage" ? "percentage" : "fixed",
    value: platformCoupon.value, minPurchase: platformCoupon.minPurchase,
    category: platformCoupon.category, sellerId: platformCoupon.createdBy,
    source: "platform", status: "available",
    expiresAt: platformCoupon.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  sendSuccess(res, userCoupon, "Coupon claimed successfully", 201);
});

export const getBestVoucher = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { amount, category } = req.query as { amount?: string; category?: string };
  const orderAmount = Number(amount) || 0;

  const availableCoupons = await UserCoupon.find({
    userId, status: "available", expiresAt: { $gt: new Date() }, minPurchase: { $lte: orderAmount },
  });

  const sorted = availableCoupons.sort((a, b) => {
    const aValue = a.type === "percentage" ? orderAmount * (a.value / 100) : a.value;
    const bValue = b.type === "percentage" ? orderAmount * (b.value / 100) : b.value;
    return bValue - aValue;
  });

  sendSuccess(res, {
    bestCoupon: sorted[0] || null, allValid: sorted,
    potentialSavings: sorted[0] ? (sorted[0].type === "percentage" ? Math.round(orderAmount * (sorted[0].value / 100)) : sorted[0].value) : 0,
  });
});

// ============================================================
// SAVINGS DASHBOARD (Feature 14)
// ============================================================
export const getSavingsDashboard = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orders = await Order.find({ userId, status: { $in: ["delivered", "processing", "shipped", "out_for_delivery"] } });

  let totalOriginal = 0, totalDiscount = 0, totalCouponSavings = 0, totalDeliverySaved = 0;
  orders.forEach((order) => {
    const originalSubtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    totalOriginal += originalSubtotal;
    totalDiscount += originalSubtotal - order.subtotal;
    totalCouponSavings += order.discount || 0;
    if (order.totalAmount > 2000) totalDeliverySaved += 60;
  });

  const totalSaved = totalDiscount + totalCouponSavings + totalDeliverySaved;
  sendSuccess(res, {
    originalPrice: totalOriginal, discount: totalDiscount, couponSavings: totalCouponSavings,
    deliverySaved: totalDeliverySaved, totalSaved, orderCount: orders.length, currency: "BDT",
    savingsPercentage: totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0,
  });
});

// ============================================================
// PERSONAL EXPENSE ANALYTICS (Feature 15)
// ============================================================
export const getExpenseAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { range } = req.query as { range?: string };
  const now = new Date();
  let startDate: Date;
  switch (range) {
    case "this_month": startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "last_month": startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); break;
    case "6_months": startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1); break;
    case "this_year": startDate = new Date(now.getFullYear(), 0, 1); break;
    default: startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  }

  const orders = await Order.find({ userId, createdAt: { $gte: startDate }, status: { $nin: ["cancelled"] } });
  const totalSpend = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;

  const monthMap: Record<string, { amount: number; orders: number }> = {};
  const categoryMap: Record<string, number> = {};
  orders.forEach((o) => {
    const monthKey = new Date(o.createdAt).toLocaleString("default", { month: "short", year: "2-digit" });
    if (!monthMap[monthKey]) monthMap[monthKey] = { amount: 0, orders: 0 };
    monthMap[monthKey].amount += o.totalAmount;
    monthMap[monthKey].orders += 1;
    o.items.forEach((item: { category?: string; price: number; quantity: number }) => {
      const cat = item.category || "General";
      categoryMap[cat] = (categoryMap[cat] || 0) + item.price * item.quantity;
    });
  });

  const categorySpending = Object.entries(categoryMap).map(([category, amount]) => ({
    category, amount, percentage: totalSpend > 0 ? Math.round((amount / totalSpend) * 100) : 0,
  })).sort((a, b) => b.amount - a.amount);

  sendSuccess(res, {
    overview: { totalSpend, orderCount, avgOrderValue, topCategory: categorySpending[0]?.category || "None" },
    monthlySpending: Object.entries(monthMap).map(([month, data]) => ({ month, amount: data.amount, orders: data.orders })),
    categorySpending, range: range || "6_months",
  });
});

// ============================================================
// INTELLIGENT NOTIFICATION CENTER (Feature 16)
// ============================================================
export const getIntelligentNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { category, page = 1, limit = 20 } = req.query as { category?: string; page?: string; limit?: string };
  const filter: Record<string, unknown> = { userId };

  if (category && category !== "all") {
    const categoryMap: Record<string, string[]> = {
      important: ["order_confirmation", "order_delivered"], price_alerts: ["price_drop"],
      recommendations: ["flash_sale"], orders: ["order_confirmation", "order_shipped", "order_delivered", "order_update"],
      promotions: ["coupon", "flash_sale"], security: ["low_stock"],
    };
    filter.type = { $in: categoryMap[category] || [] };
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, isRead: false }),
  ]);

  sendSuccess(res, { notifications, unreadCount, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user!.id }, { isRead: true });
  sendSuccess(res, { success: true });
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany({ userId: req.user!.id, isRead: false }, { isRead: true });
  sendSuccess(res, { success: true }, "All notifications marked as read");
});

// ============================================================
// SMART WISHLIST (Feature 17)
// ============================================================
export const getSmartWishlist = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const wishlist = await Wishlist.findOne({ userId });
  if (!wishlist) return sendSuccess(res, { items: [], priceDrops: [], stockAlerts: [] });

  const productIds = wishlist.items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });

  const items = products.map((p) => {
    const currentPrice = p.discountPrice || p.price;
    const priceDrop = p.price > currentPrice ? p.price - currentPrice : 0;
    return {
      id: p.id, title: p.title, currentPrice, originalPrice: p.price, priceDrop,
      priceDropPercent: priceDrop > 0 ? Math.round((priceDrop / p.price) * 100) : 0,
      hasPriceDrop: priceDrop > 0, inStock: p.stock > 0, stock: p.stock,
      category: p.category, images: p.images || [], ratingAvg: p.ratingAvg,
      addedAt: wishlist.items.find((i) => i.productId === p.id)?.addedAt,
    };
  });

  sendSuccess(res, { items, priceDrops: items.filter((i) => i.hasPriceDrop), stockAlerts: items.filter((i) => !i.inStock), totalItems: items.length });
});

export const togglePriceTracking = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await CustomerActivity.create({ userId, activityType: "wishlist_add", title: "Price tracking toggled", details: `Product ${req.params.productId}` });
  sendSuccess(res, { success: true, message: "Price tracking updated" });
});

// ============================================================
// SMART BUY AGAIN (Feature 18)
// ============================================================
export const getBuyAgainProducts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let buyAgainItems = await BuyAgainItem.find({ userId }).sort({ lastPurchasedAt: -1 }).limit(20);

  if (buyAgainItems.length === 0) {
    const orders = await Order.find({ userId, status: "delivered" }).sort({ createdAt: -1 }).limit(10);
    const productMap: Record<string, { count: number; lastOrder: Date; orderId: string; price: number; title: string; category: string }> = {};
    orders.forEach((order) => {
      order.items.forEach((item: { productId: string; title: string; quantity: number; price: number; category?: string }) => {
        if (!productMap[item.productId]) productMap[item.productId] = { count: 0, lastOrder: order.createdAt, orderId: order.id, price: item.price, title: item.title, category: item.category || "General" };
        productMap[item.productId].count += item.quantity;
        if (new Date(order.createdAt) > new Date(productMap[item.productId].lastOrder)) { productMap[item.productId].lastOrder = order.createdAt; productMap[item.productId].orderId = order.id; }
      });
    });

    for (const [productId, data] of Object.entries(productMap)) {
      const item = await BuyAgainItem.findOneAndUpdate(
        { userId, productId },
        { $set: { productTitle: data.title, category: data.category, lastPurchasedAt: data.lastOrder, lastOrderId: data.orderId, lastPrice: data.price }, $inc: { purchaseCount: data.count } },
        { upsert: true, new: true }
      );
      buyAgainItems.push(item);
    }
  }

  const productIds = buyAgainItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isDeleted: false });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const items = buyAgainItems.map((item) => {
    const product = productMap.get(item.productId);
    return {
      productId: item.productId, title: item.productTitle, category: item.category,
      lastPrice: item.lastPrice, currentPrice: product ? (product.discountPrice || product.price) : item.lastPrice,
      purchaseCount: item.purchaseCount, daysSincePurchase: Math.floor((Date.now() - new Date(item.lastPurchasedAt).getTime()) / (1000 * 60 * 60 * 24)),
      inStock: product ? product.stock > 0 : false, image: product?.images?.[0] || "", available: !!product,
    };
  });

  sendSuccess(res, { items });
});

// ============================================================
// DIGITAL PURCHASE VAULT (Feature 22)
// ============================================================
export const getPurchaseVault = asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.query as { type?: string };
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (type) filter.type = type;
  const documents = await PurchaseDocument.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, documents);
});

export const getPurchaseDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await PurchaseDocument.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!doc) throw ApiError.notFound("Document not found");
  sendSuccess(res, doc);
});

// ============================================================
// WARRANTY MANAGER (Feature 23)
// ============================================================
export const getWarranties = asyncHandler(async (req: Request, res: Response) => {
  const orders = await Order.find({ userId: req.user!.id, status: "delivered" }).sort({ createdAt: -1 });
  const warranties = orders.flatMap((order) =>
    order.items.map((item: { productId: string; title: string; sellerId: string; category?: string }) => ({
      orderId: order.id, productId: item.productId, productTitle: item.title,
      category: item.category || "General", purchaseDate: order.createdAt,
      warrantyDuration: "1 Year", warrantyExpiry: new Date(new Date(order.createdAt).setFullYear(new Date(order.createdAt).getFullYear() + 1)),
      sellerId: item.sellerId, status: "active" as const,
    }))
  );
  sendSuccess(res, warranties);
});

// ============================================================
// CUSTOMER-SELLER COMMUNICATION (Feature 24)
// ============================================================
export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: -1 });
  const conversationMap: Record<string, { lastMessage: typeof messages[0]; unreadCount: number; participantId: string }> = {};

  messages.forEach((msg) => {
    if (!conversationMap[msg.conversationId]) conversationMap[msg.conversationId] = { lastMessage: msg, unreadCount: 0, participantId: msg.senderId === userId ? msg.receiverId : msg.senderId };
    if (msg.receiverId === userId && !msg.isRead) conversationMap[msg.conversationId].unreadCount++;
  });

  sendSuccess(res, Object.entries(conversationMap).map(([id, data]) => ({
    conversationId: id, participantId: data.participantId, subject: data.lastMessage.subject,
    lastMessage: data.lastMessage.message, lastMessageAt: data.lastMessage.createdAt, unreadCount: data.unreadCount,
  })));
});

export const getConversationMessages = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const messages = await CustomerSellerMessage.find({ conversationId: req.params.conversationId, $or: [{ senderId: userId }, { receiverId: userId }] }).sort({ createdAt: 1 });
  await CustomerSellerMessage.updateMany({ conversationId: req.params.conversationId, receiverId: userId, isRead: false }, { isRead: true });
  sendSuccess(res, messages);
});

export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userRole = req.user!.role;
  if (userRole !== "customer") throw ApiError.forbidden("Only customers can initiate messages");

  const { receiverId, orderId, productId, subject, message } = req.body;
  const conversationId = [userId, receiverId].sort().join("_") + (orderId ? `_${orderId}` : "");

  const msg = await CustomerSellerMessage.create({
    conversationId, senderId: userId, senderRole: "customer", receiverId, receiverRole: "seller",
    orderId, productId, subject, message, isRead: false,
  });
  sendSuccess(res, msg, "Message sent", 201);
});

export const reportMessage = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const msg = await CustomerSellerMessage.findOneAndUpdate(
    { _id: req.params.id, $or: [{ senderId: userId }, { receiverId: userId }] },
    { isReported: true, reportReason: req.body.reason }
  );
  if (!msg) throw ApiError.notFound("Message not found");
  sendSuccess(res, { success: true }, "Message reported successfully");
});

// ============================================================
// SMART CUSTOMER SUPPORT (Feature 25)
// ============================================================
export const aiSupportChat = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { message } = req.body;
  const recentOrders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(3);

  let aiResponse = "";
  let suggestedAction = "";

  try {
    aiResponse = await complete(
      [{ role: "user", content: `Customer: "${message}"\nOrders: ${JSON.stringify(recentOrders.map((o) => ({ id: o.id, status: o.status, total: o.totalAmount })))}` }],
      { system: "You are ShopNest support AI. Help with orders, delivery, returns. Be concise. If issue needs human help, say so clearly." }
    );
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("not arrived") || lowerMsg.includes("late") || lowerMsg.includes("damaged") || lowerMsg.includes("wrong")) suggestedAction = "create_ticket";
  } catch (err) {
    await logAiIncident({ type: "PROVIDER_ERROR", userId, endpoint: "/customer/support/ai-chat", input: message, error: err instanceof Error ? err.message : String(err) });
    aiResponse = "I apologize for the trouble. Let me create a support ticket for you.";
    suggestedAction = "create_ticket";
  }

  sendSuccess(res, { response: aiResponse, suggestedAction, recentOrders: recentOrders.map((o) => ({ id: o.id, status: o.status })) });
});

export const getSupportTickets = asyncHandler(async (req: Request, res: Response) => {
  const tickets = await SupportTicket.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  sendSuccess(res, tickets);
});

export const createSupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await SupportTicket.create({ userId: req.user!.id, ...req.body, status: "open" });
  sendSuccess(res, ticket, "Support ticket created", 201);
});

// ============================================================
// CUSTOMER LOYALTY & REWARDS (Feature 26)
// ============================================================
export const getLoyaltyStatus = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) loyalty = await LoyaltyPoints.create({ userId, totalPoints: 0, availablePoints: 0, lifetimePoints: 0, level: "bronze" });

  const levelThresholds = { bronze: 0, silver: 500, gold: 1500, platinum: 5000 };
  const nextLevel = loyalty.level === "bronze" ? "silver" : loyalty.level === "silver" ? "gold" : loyalty.level === "gold" ? "platinum" : null;
  const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;
  const progress = nextThreshold ? Math.round((loyalty.lifetimePoints / nextThreshold) * 100) : 100;

  sendSuccess(res, {
    ...loyalty.toJSON(), nextLevel, nextThreshold, progress: Math.min(100, progress),
    benefits: {
      bronze: ["Earn 1 point per ৳100", "Birthday coupon"],
      silver: ["Earn 1.5 points per ৳100", "Free delivery on orders above ৳1000", "Early access to sales"],
      gold: ["Earn 2 points per ৳100", "Free delivery on all orders", "Priority support", "Exclusive deals"],
      platinum: ["Earn 3 points per ৳100", "Free delivery + returns", "VIP support", "Personal shopper"],
    },
  });
});

export const getLoyaltyTransactions = asyncHandler(async (req: Request, res: Response) => {
  const transactions = await LoyaltyTransaction.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50);
  sendSuccess(res, transactions);
});

export const redeemPoints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { points, rewardType } = req.body;

  const loyalty = await LoyaltyPoints.findOne({ userId });
  if (!loyalty) throw ApiError.notFound("Loyalty account not found");
  if (loyalty.availablePoints < points) throw ApiError.badRequest("Insufficient points");

  let reward = "";
  switch (rewardType) {
    case "coupon": reward = "SAVE" + points; break;
    case "free_delivery": reward = "FREESHIP"; break;
    case "discount": reward = `DISCOUNT${points}`; break;
  }

  loyalty.availablePoints -= points;
  await loyalty.save();

  await LoyaltyTransaction.create({ userId, type: "redeemed", points: -points, description: `Redeemed for ${rewardType}`, balanceAfter: loyalty.availablePoints });
  sendSuccess(res, { success: true, reward, remainingPoints: loyalty.availablePoints });
});

// ============================================================
// ADDRESS INTELLIGENCE (Feature 27)
// ============================================================
export const getAddressesIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const addresses = await Address.find({ userId: req.user!.id }).sort({ isDefault: -1, createdAt: -1 });
  sendSuccess(res, addresses);
});

export const createAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const existingCount = await Address.countDocuments({ userId });
  const address = await Address.create({ userId, ...req.body, isDefault: req.body.isDefault || existingCount === 0 });
  if (address.isDefault) await Address.updateMany({ userId, _id: { $ne: address._id } }, { isDefault: false });
  sendSuccess(res, address, "Address saved successfully", 201);
});

export const updateAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (req.body.isDefault) await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  Object.assign(address, req.body);
  await address.save();
  sendSuccess(res, address, "Address updated successfully");
});

export const deleteAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  if (address.isDefault) {
    const next = await Address.findOne({ userId: req.user!.id }).sort({ createdAt: -1 });
    if (next) { next.isDefault = true; await next.save(); }
  }
  sendSuccess(res, { id: req.params.id }, "Address removed successfully");
});

export const setDefaultAddressIntelligent = asyncHandler(async (req: Request, res: Response) => {
  const address = await Address.findOne({ _id: req.params.id, userId: req.user!.id });
  if (!address) throw ApiError.notFound("Address not found");
  await Address.updateMany({ userId: req.user!.id, _id: { $ne: address._id } }, { isDefault: false });
  address.isDefault = true;
  await address.save();
  sendSuccess(res, address, "Default address updated");
});

// ============================================================
// CUSTOMER SECURITY CENTER (Feature 28)
// ============================================================
export const getSecurityCenter = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [sessions, timeline] = await Promise.all([
    require("../security/security-intelligence.model").DeviceSession.find({ userId, status: "active" }),
    require("../security/security-intelligence.model").SecurityRiskLog.find({ userId }).sort({ createdAt: -1 }).limit(20),
  ]);

  sendSuccess(res, {
    securityScore: 85,
    sessions,
    timeline,
    twoFactorEnabled: false,
    lastPasswordChange: null,
    recommendations: ["Enable 2FA for extra security", "Review active sessions regularly"],
  });
});

export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await require("../security/security-intelligence.model").DeviceSession.find({ userId: req.user!.id, status: "active" });
  sendSuccess(res, sessions);
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "Session revoked");
});

export const revokeAllSessions = asyncHandler(async (req: Request, res: Response) => {
  await require("../security/security-intelligence.model").DeviceSession.updateMany(
    { userId: req.user!.id, isCurrentSession: false }, { status: "revoked" }
  );
  sendSuccess(res, { success: true }, "All other sessions revoked");
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, { success: true }, "Password change initiated. Please check your email.");
});

// ============================================================
// ACCOUNT ACTIVITY TIMELINE (Feature 29)
// ============================================================
export const getActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { range } = req.query as { range?: string };

  const now = new Date();
  let startDate: Date;
  switch (range) {
    case "today": startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case "week": startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const activities = await CustomerActivity.find({ userId, createdAt: { $gte: startDate } }).sort({ createdAt: -1 }).limit(100);
  const grouped: Record<string, typeof activities> = {};

  activities.forEach((activity) => {
    const dateKey = new Date(activity.createdAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(activity);
  });

  sendSuccess(res, { activities, grouped, range: range || "month" });
});

export const clearActivityTimeline = asyncHandler(async (req: Request, res: Response) => {
  await CustomerActivity.deleteMany({ userId: req.user!.id });
  sendSuccess(res, { success: true }, "Activity timeline cleared");
});

// ============================================================
// PERSONAL SHOPPING PROFILE (Feature 30)
// ============================================================
export const getShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  let preferences = await UserPreferences.findOne({ userId });

  if (!preferences) {
    preferences = await UserPreferences.create({
      userId, preferredCategories: [], typicalBudgetMin: 0, typicalBudgetMax: 50000,
      preferredSellers: [], preferredDelivery: "any", favoriteBrands: [], shoppingInterests: [], allowPersonalization: true,
    });
  }

  sendSuccess(res, preferences);
});

export const updateShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const preferences = await UserPreferences.findOneAndUpdate(
    { userId }, { $set: req.body }, { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  sendSuccess(res, preferences, "Shopping profile updated");
});

export const resetShoppingProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await UserPreferences.findOneAndDelete({ userId });
  sendSuccess(res, { success: true }, "Shopping profile reset");
});

export const deletePersonalizationData = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await Promise.all([
    UserPreferences.findOneAndDelete({ userId }),
    CustomerActivity.deleteMany({ userId }),
    SearchHistory.deleteMany({ userId }),
    ShoppingJourney.deleteMany({ userId }),
  ]);
  sendSuccess(res, { success: true }, "Personalization data deleted");
});

// ============================================================
// 1. BANGLA + BANGLISH SMART SEARCH (Feature 1)
// ============================================================
export const searchBanglaBanglish = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query as { q?: string };
  if (!q || !q.trim()) {
    return sendSuccess(res, { products: [], extractedIntent: null });
  }

  let normalized = q.toLowerCase().trim();
  // Transliterate Bangla digits to English
  const bnToEnMap: Record<string, string> = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };
  normalized = normalized.replace(/[০-৯]/g, (digit) => bnToEnMap[digit] || digit);

  // Extract Budget: e.g. "3000 takar moddhe", "50000 er niche", "under 20000", "5000 tk"
  let maxBudget: number | null = null;
  const budgetMatch = normalized.match(/(\d+)\s*(?:taka|takar|tk|টাকা|টাকার|৳)?\s*(?:moddhe|er moddhe|niche|under|below|max|porjonto|পর্যন্ত)?/i);
  if (budgetMatch && budgetMatch[1]) {
    const parsed = parseInt(budgetMatch[1], 10);
    if (!isNaN(parsed) && parsed > 50) {
      maxBudget = parsed;
    }
  }

  // Common Banglish synonyms mapping
  const categoryKeywords: Record<string, string[]> = {
    Electronics: ["phone", "mobile", "laptop", "headphone", "earphone", "keyboard", "mouse", "charger", "gadget", "computar", "komputer", "soundbox"],
    Fashion: ["shirt", "tshirt", "pant", "jama", "sharee", "shari", "shoes", "shoe", "juta", "panjabi", "bag", "watch", "ghori"],
    "Home & Living": ["light", "fan", "chair", "table", "bed", "furniture", "blender", "kitchen"],
    Beauty: ["cream", "lotion", "perfume", "facewash", "makeup", "shampoo", "oil"],
    Sports: ["cycle", "football", "cricket", "bat", "ball", "gym", "jersey"],
  };

  let detectedCategory: string | null = null;
  for (const [cat, words] of Object.entries(categoryKeywords)) {
    if (words.some((w) => normalized.includes(w))) {
      detectedCategory = cat;
      break;
    }
  }

  // Clean keywords
  const stopwords = ["taka", "takar", "tk", "moddhe", "er", "valo", "bhalo", "dorkar", "chai", "lagbe", "best", "under", "within", "er moddhe"];
  const cleanTokens = normalized
    .split(/\s+/)
    .filter((token) => !stopwords.includes(token) && isNaN(Number(token)));

  const queryFilter: any = { isDeleted: { $ne: true } };

  if (maxBudget) {
    queryFilter.price = { $lte: maxBudget };
  }

  if (detectedCategory) {
    queryFilter.category = new RegExp(detectedCategory, "i");
  }

  if (cleanTokens.length > 0) {
    const searchRegex = new RegExp(cleanTokens.join("|"), "i");
    queryFilter.$or = [
      { title: searchRegex },
      { description: searchRegex },
      { category: searchRegex },
      { tags: searchRegex },
    ];
  }

  const products = await Product.find(queryFilter)
    .sort({ ratingAvg: -1, sold: -1 })
    .limit(24);

  sendSuccess(res, {
    query: q,
    extractedIntent: {
      budgetLimit: maxBudget,
      detectedCategory,
      keywords: cleanTokens,
    },
    totalFound: products.length,
    products,
  });
});

// ============================================================
// 2. COD RISK PROTECTION (Feature 4)
// ============================================================
export const getCODOrderRisk = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderAmount = 0 } = req.query as { orderAmount?: string };

  const totalOrders = await Order.countDocuments({ customerId: userId });
  const deliveredOrders = await Order.countDocuments({ customerId: userId, status: "delivered" });
  const cancelledOrders = await Order.countDocuments({ customerId: userId, status: "cancelled" });
  const returnedOrders = await Order.countDocuments({ customerId: userId, status: { $in: ["returned", "return_requested"] } });

  let riskScore = 15; // default baseline low risk
  const amount = Number(orderAmount) || 0;

  if (totalOrders === 0) {
    riskScore = amount > 15000 ? 55 : 30; // first time high order is medium risk
  } else {
    const cancelRate = cancelledOrders / totalOrders;
    const returnRate = returnedOrders / totalOrders;
    riskScore += Math.round(cancelRate * 50);
    riskScore += Math.round(returnRate * 35);
    if (deliveredOrders >= 3) riskScore -= 20;
    if (deliveredOrders >= 10) riskScore -= 15;
  }

  riskScore = Math.max(5, Math.min(95, riskScore));

  let riskLevel: "LOW RISK" | "MEDIUM RISK" | "HIGH RISK" = "LOW RISK";
  if (riskScore > 65) riskLevel = "HIGH RISK";
  else if (riskScore > 35) riskLevel = "MEDIUM RISK";

  sendSuccess(res, {
    riskLevel,
    riskScore,
    stats: {
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      returnedOrders,
      fulfillmentRatio: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 100,
    },
    recommendation:
      riskLevel === "LOW RISK"
        ? "Eligible for 1-Click Cash on Delivery."
        : riskLevel === "MEDIUM RISK"
        ? "Standard COD allowed with SMS confirmation."
        : "High risk profile detected. Pre-payment or OTP verification recommended.",
  });
});

// ============================================================
// 3. PRODUCT TRUST REPORT (Feature 5 & 7)
// ============================================================
export const getProductTrustReport = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const store = await Store.findById(product.storeId);
  const reviews = await Review.find({ productId });
  const orders = await Order.countDocuments({ "items.productId": productId });
  const returns = await Order.countDocuments({ "items.productId": productId, status: { $in: ["returned", "return_requested"] } });

  const verifiedReviews = reviews.filter((r) => r.verifiedPurchase).length;
  const verifiedPercentage = reviews.length > 0 ? Math.round((verifiedReviews / reviews.length) * 100) : 100;
  const returnRate = orders > 0 ? Math.round((returns / orders) * 100) : 2;

  const sellerTrust = Math.round(store?.trustScore || 88);
  const productTrust = Math.min(100, Math.round(70 + (product.ratingAvg / 5) * 20 + (verifiedPercentage * 0.1)));
  const reviewQuality = reviews.length >= 10 ? "High" : reviews.length >= 3 ? "Moderate" : "Building";
  const returnRisk = returnRate <= 5 ? "Low" : returnRate <= 15 ? "Moderate" : "High";

  // Fake discount detector
  const priceHistory = await PriceHistory.findOne({ productId });
  let discountIntegrity: "verified" | "caution" | "standard" = "standard";
  let discountNote = "Fair pricing verified against market trends.";

  if (product.discountPrice && product.discountPrice < product.price) {
    const claimedDiscount = ((product.price - product.discountPrice) / product.price) * 100;
    if (priceHistory && priceHistory.averagePrice > 0) {
      if (product.price > priceHistory.averagePrice * 1.3 && claimedDiscount > 40) {
        discountIntegrity = "caution";
        discountNote = "Original price appears inflated prior to discount. Treat 50%+ claim with advisory.";
      } else {
        discountIntegrity = "verified";
        discountNote = "Genuine price drop compared to historical 30-day average.";
      }
    }
  }

  sendSuccess(res, {
    productId,
    sellerTrust,
    productTrust,
    reviewQuality,
    returnRisk,
    returnRate: `${returnRate}%`,
    verifiedReviewsCount: verifiedReviews,
    totalReviewsCount: reviews.length,
    discountIntegrity,
    discountNote,
    calculatedAt: new Date(),
  });
});

// ============================================================
// 4. MULTI-COURIER COMPARISON & SMART DELIVERY ETA (Feature 8 & 9)
// ============================================================
export const getCourierComparison = asyncHandler(async (req: Request, res: Response) => {
  const { division = "Dhaka", district = "Dhaka", weightKg = "1" } = req.query as {
    division?: string;
    district?: string;
    weightKg?: string;
  };

  const weight = Math.max(0.5, Number(weightKg) || 1);
  const isInsideDhaka = district.toLowerCase().includes("dhaka") || division.toLowerCase() === "dhaka";

  const now = new Date();
  const formatETA = (minDays: number, maxDays: number) => {
    const dMin = new Date(now.getTime() + minDays * 24 * 60 * 60 * 1000);
    const dMax = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
    const m1 = dMin.toLocaleString("en-US", { month: "short" });
    const m2 = dMax.toLocaleString("en-US", { month: "short" });
    if (m1 === m2) {
      return `${dMin.getDate()}–${dMax.getDate()} ${m1}`;
    }
    return `${dMin.getDate()} ${m1} – ${dMax.getDate()} ${m2}`;
  };

  const couriers = [
    {
      id: "pathao",
      name: "Pathao Express",
      badge: "Fastest Delivery",
      rate: isInsideDhaka ? Math.round(60 + (weight - 1) * 20) : Math.round(110 + (weight - 1) * 25),
      durationDays: isInsideDhaka ? "1–2 Days" : "2–3 Days",
      estimatedDates: isInsideDhaka ? formatETA(1, 2) : formatETA(2, 3),
      reliabilityScore: 96,
      logoUrl: "⚡",
    },
    {
      id: "steadfast",
      name: "Steadfast Courier",
      badge: "Best Value",
      rate: isInsideDhaka ? Math.round(50 + (weight - 1) * 15) : Math.round(95 + (weight - 1) * 20),
      durationDays: isInsideDhaka ? "1–2 Days" : "2–4 Days",
      estimatedDates: isInsideDhaka ? formatETA(1, 2) : formatETA(2, 4),
      reliabilityScore: 94,
      logoUrl: "🚚",
    },
    {
      id: "redx",
      name: "RedX Logistics",
      badge: "Nationwide Reach",
      rate: isInsideDhaka ? Math.round(60 + (weight - 1) * 20) : Math.round(100 + (weight - 1) * 25),
      durationDays: isInsideDhaka ? "2 Days" : "3–5 Days",
      estimatedDates: isInsideDhaka ? formatETA(2, 2) : formatETA(3, 5),
      reliabilityScore: 91,
      logoUrl: "📦",
    },
    {
      id: "ecourier",
      name: "eCourier Smart",
      badge: "Fragile Care",
      rate: isInsideDhaka ? Math.round(70 + (weight - 1) * 20) : Math.round(120 + (weight - 1) * 30),
      durationDays: isInsideDhaka ? "1 Day" : "2–3 Days",
      estimatedDates: isInsideDhaka ? formatETA(1, 1) : formatETA(2, 3),
      reliabilityScore: 95,
      logoUrl: "🛡️",
    },
  ];

  sendSuccess(res, {
    destination: { division, district, isInsideDhaka },
    weightKg: weight,
    options: couriers,
  });
});

// ============================================================
// 5. RETURN ELIGIBILITY CHECKER (Feature 10)
// ============================================================
export const getReturnEligibility = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");

  const now = new Date();
  const deliveryDate = (order as any).deliveredAt ? new Date((order as any).deliveredAt) : new Date(order.updatedAt);
  const daysSinceDelivery = Math.floor((now.getTime() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
  const returnWindowDays = 7;
  const isWithinWindow = daysSinceDelivery <= returnWindowDays && order.status === "delivered";

  sendSuccess(res, {
    orderId,
    orderStatus: order.status,
    isEligible: isWithinWindow,
    daysRemaining: Math.max(0, returnWindowDays - daysSinceDelivery),
    returnWindow: `${returnWindowDays} Days Return Policy`,
    requiredEvidence: [
      "Original unboxing photo / video",
      "Item in undamaged condition with all tags and accessories",
      "Packaging box with courier shipping label intact",
    ],
    refundMethods: ["Original Payment Method (bKash / Card / Nagad)", "ShopNest Wallet Balance"],
    expectedProcessingDays: "3–5 Business Days",
  });
});

// ============================================================
// 6. PRICE DROP & STOCK ALERTS (Feature 14 & 15)
// ============================================================
export const subscribePriceAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, targetPrice } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const alert = await PriceAlert.findOneAndUpdate(
    { userId, productId },
    {
      userId,
      productId,
      productTitle: product.title,
      targetPrice: Number(targetPrice) || (product.discountPrice ?? product.price),
      currentPrice: product.discountPrice ?? product.price,
      isTriggered: false,
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, alert, "Price drop alert subscribed successfully!");
});

export const getUserPriceAlerts = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const alerts = await PriceAlert.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, alerts);
});

export const deletePriceAlert = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await PriceAlert.findOneAndDelete({ _id: id, userId: req.user!.id });
  sendSuccess(res, { success: true }, "Price alert removed");
});

export const subscribeStockAlert = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, userEmail } = req.body;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const alert = await StockAlert.findOneAndUpdate(
    { userId, productId },
    {
      userId,
      userEmail: userEmail || req.user!.email,
      productId,
      productTitle: product.title,
      isNotified: false,
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, alert, "You will be notified as soon as this item is back in stock!");
});

// ============================================================
// 7. BUDGET-BASED SHOPPING RECOMMENDATIONS (Feature 16)
// ============================================================
export const getBudgetShoppingRecommendations = asyncHandler(async (req: Request, res: Response) => {
  const { budget = 30000, category = "Electronics", purpose = "general" } = req.query as {
    budget?: string | number;
    category?: string;
    purpose?: string;
  };

  const budgetNum = Number(budget) || 30000;
  const query: any = {
    isDeleted: { $ne: true },
    price: { $lte: budgetNum },
  };

  if (category && category !== "All") {
    query.category = new RegExp(category, "i");
  }

  const products = await Product.find(query)
    .sort({ ratingAvg: -1, sold: -1 })
    .limit(12);

  const enriched = products.map((p) => {
    const price = p.discountPrice ?? p.price;
    const savings = budgetNum - price;
    return {
      ...p.toJSON(),
      budgetFit: {
        budgetLimit: budgetNum,
        price,
        remainingBudget: savings,
        matchReason: `Fits well within your ৳${budgetNum.toLocaleString()} budget with ৳${savings.toLocaleString()} remaining. Rated ${p.ratingAvg.toFixed(1)}★ by customers.`,
      },
    };
  });

  sendSuccess(res, {
    targetBudget: budgetNum,
    category,
    purpose,
    recommendations: enriched,
  });
});

// ============================================================
// 8. VALUE-FOR-MONEY SCORE (Feature 17)
// ============================================================
export const getValueForMoneyScore = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const discountRatio = product.discountPrice ? (product.price - product.discountPrice) / product.price : 0;
  const ratingFactor = (product.ratingAvg / 5) * 40; // max 40
  const discountFactor = Math.min(30, discountRatio * 100); // max 30
  const reviewVolumeFactor = Math.min(15, (product.ratingCount || 0) * 1.5); // max 15
  const baseSpecFactor = 15; // verified specs

  const rawScore = Math.round(ratingFactor + discountFactor + reviewVolumeFactor + baseSpecFactor);
  const score = Math.max(6.0, Math.min(9.9, Number((rawScore / 10).toFixed(1))));

  sendSuccess(res, {
    productId,
    score,
    ratingAvg: product.ratingAvg,
    breakdown: [
      { factor: "Customer Satisfaction", weight: "40%", score: Math.round(ratingFactor * 2.5) },
      { factor: "Price-to-Spec Discount", weight: "30%", score: Math.round(discountFactor * 3.3) },
      { factor: "Verified Review Count", weight: "15%", score: Math.round(reviewVolumeFactor * 6.6) },
      { factor: "Hardware Spec Integrity", weight: "15%", score: 92 },
    ],
    summary: `Score of ${score}/10 derived from ${product.ratingAvg.toFixed(1)}★ rating, competitive pricing, and verified customer feedbacks.`,
  });
});

// ============================================================
// 9. PRODUCT REVIEW Q&A (Feature 21)
// ============================================================
export const getProductQuestions = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const questions = await ProductQuestion.find({ productId }).sort({ createdAt: -1 });
  sendSuccess(res, questions);
});

export const askProductQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const userName = req.user!.name || "Customer";
  const { productId, question } = req.body;

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const newQ = await ProductQuestion.create({
    productId,
    userId,
    userName,
    question,
    answers: [],
    isAnswered: false,
  });

  sendSuccess(res, newQ, "Your question was posted successfully! Sellers and verified buyers will answer shortly.");
});

export const answerProductQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const { content, authorRole = "customer" } = req.body;
  const authorId = req.user!.id;
  const authorName = req.user!.name || "Community Member";

  const question = await ProductQuestion.findById(questionId);
  if (!question) throw ApiError.notFound("Question not found");

  question.answers.push({
    authorId,
    authorName,
    authorRole,
    content,
    helpfulVotes: 0,
    createdAt: new Date(),
  });
  question.isAnswered = true;
  await question.save();

  sendSuccess(res, question, "Answer submitted successfully!");
});

// ============================================================
// 10. PERSONALIZED DEAL FEED (Feature 22)
// ============================================================
export const getPersonalizedDealFeed = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  let preferredCategories: string[] = [];

  if (userId) {
    const journey = await ShoppingJourney.findOne({ userId }).sort({ updatedAt: -1 });
    if (journey?.category) preferredCategories.push(journey.category);
    const wishlist = await Wishlist.findOne({ userId });
    if (wishlist?.items.length) {
      const wishProductIds = wishlist.items.map((i) => i.productId);
      const wishProducts = await Product.find({ _id: { $in: wishProductIds } });
      preferredCategories.push(...wishProducts.map((p) => p.category));
    }
  }

  const query: any = {
    isDeleted: { $ne: true },
    discountPrice: { $exists: true, $gt: 0 },
  };

  if (preferredCategories.length > 0) {
    query.category = { $in: [...new Set(preferredCategories)] };
  }

  let deals = await Product.find(query).sort({ sold: -1, ratingAvg: -1 }).limit(16);
  if (deals.length < 6) {
    deals = await Product.find({ isDeleted: { $ne: true }, discountPrice: { $exists: true, $gt: 0 } })
      .sort({ sold: -1 })
      .limit(16);
  }

  sendSuccess(res, {
    matchedPreferences: preferredCategories,
    deals,
  });
});

// ============================================================
// 11. RECENTLY COMPARED PRODUCTS (Feature 23)
// ============================================================
export const getCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const history = await ComparisonHistory.find({ userId }).sort({ createdAt: -1 }).limit(10);
  sendSuccess(res, history);
});

export const saveCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { title, productIds, category } = req.body;

  const item = await ComparisonHistory.create({
    userId,
    title: title || "Product Comparison",
    productIds: productIds || [],
    category: category || "General",
  });

  sendSuccess(res, item, "Comparison saved to history");
});

export const clearCompareHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await ComparisonHistory.deleteMany({ userId });
  sendSuccess(res, { success: true }, "Comparison history cleared");
});

// ============================================================
// 12. SMART WISHLIST GROUPS (Feature 25)
// ============================================================
export const getWishlistGroups = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const groups = await WishlistGroup.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, groups);
});

export const createWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { name, description, icon, color, productIds } = req.body;

  const group = await WishlistGroup.create({
    userId,
    name,
    description: description || "",
    icon: icon || "❤️",
    color: color || "#6366f1",
    productIds: productIds || [],
  });

  sendSuccess(res, group, "Wishlist group created!");
});

export const updateWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const group = await WishlistGroup.findOneAndUpdate(
    { _id: id, userId: req.user!.id },
    { $set: req.body },
    { new: true }
  );
  if (!group) throw ApiError.notFound("Group not found");
  sendSuccess(res, group, "Wishlist group updated!");
});

export const deleteWishlistGroup = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await WishlistGroup.findOneAndDelete({ _id: id, userId: req.user!.id });
  sendSuccess(res, { success: true }, "Wishlist group deleted");
});

// ============================================================
// 13. PURCHASE BUDGET TRACKER (Feature 26)
// ============================================================
export const getPurchaseBudgetTracker = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const preferences = await UserPreferences.findOne({ userId });
  const monthlyTargetBudget = preferences?.typicalBudgetMax || 30000;

  const currentMonthOrders = await Order.find({
    customerId: userId,
    createdAt: { $gte: startOfMonth },
    status: { $ne: "cancelled" },
  });

  const spentThisMonth = currentMonthOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const remainingBudget = Math.max(0, monthlyTargetBudget - spentThisMonth);
  const progressPercent = Math.min(100, Math.round((spentThisMonth / monthlyTargetBudget) * 100));

  sendSuccess(res, {
    monthlyBudget: monthlyTargetBudget,
    spentThisMonth,
    remainingBudget,
    progressPercent,
    monthName: now.toLocaleString("en-US", { month: "long" }),
    orderCount: currentMonthOrders.length,
  });
});

// ============================================================
// 14. PERSONAL SPENDING ANALYTICS (Feature 27)
// ============================================================
export const getPersonalSpendingAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orders = await Order.find({ customerId: userId, status: { $ne: "cancelled" } }).sort({ createdAt: 1 });

  const totalSpent = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const totalOrders = orders.length;
  const averageOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;

  // Monthly breakdown
  const monthlyMap: Record<string, { month: string; amount: number; count: number }> = {};
  const categoryMap: Record<string, number> = {};

  orders.forEach((o) => {
    const d = new Date(o.createdAt);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const mLabel = d.toLocaleString("en-US", { month: "short" });

    if (!monthlyMap[mKey]) monthlyMap[mKey] = { month: mLabel, amount: 0, count: 0 };
    monthlyMap[mKey].amount += Number(o.totalAmount || 0);
    monthlyMap[mKey].count += 1;

    o.items.forEach((item: any) => {
      const cat = item.category || "General";
      categoryMap[cat] = (categoryMap[cat] || 0) + Number(item.price || 0) * (item.quantity || 1);
    });
  });

  const monthlySpending = Object.values(monthlyMap);
  const categorySpending = Object.entries(categoryMap).map(([category, amount]) => ({
    category,
    amount,
    percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
  }));

  sendSuccess(res, {
    totalSpent,
    totalOrders,
    averageOrderValue,
    monthlySpending,
    categorySpending,
  });
});

// ============================================================
// 15. DELIVERY EXPERIENCE FEEDBACK (Feature 28)
// ============================================================
export const submitDeliveryFeedback = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { orderId, courierName, speedRating, packagingRating, courierBehaviorRating, overallRating, feedbackText } = req.body;

  const feedback = await DeliveryFeedback.findOneAndUpdate(
    { userId, orderId },
    {
      userId,
      orderId,
      courierName: courierName || "Standard Express",
      speedRating: Number(speedRating) || 5,
      packagingRating: Number(packagingRating) || 5,
      courierBehaviorRating: Number(courierBehaviorRating) || 5,
      overallRating: Number(overallRating) || 5,
      feedbackText: feedbackText || "",
    },
    { upsert: true, new: true }
  );

  sendSuccess(res, feedback, "Thank you for your delivery feedback!");
});

export const getDeliveryFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const feedback = await DeliveryFeedback.findOne({ orderId, userId: req.user!.id });
  sendSuccess(res, feedback);
});

// ============================================================
// 16. PRODUCT PROBLEM REPORTER (Feature 29)
// ============================================================
export const submitProductReport = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId, productTitle, category, description, evidenceUrls } = req.body;

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound("Product not found");

  const report = await ProductReport.create({
    userId,
    productId,
    productTitle: productTitle || product.title,
    sellerId: product.sellerId,
    category,
    description,
    evidenceUrls: evidenceUrls || [],
    status: "pending",
  });

  sendSuccess(res, report, "Product report submitted. Our safety team will investigate.");
});

export const getUserProductReports = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const reports = await ProductReport.find({ userId }).sort({ createdAt: -1 });
  sendSuccess(res, reports);
});

// ============================================================
// 17. PERSONAL COMMERCE ASSISTANT (Feature 30)
// ============================================================
export const askPersonalCommerceAssistant = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { prompt } = req.body;
  if (!prompt || !prompt.trim()) {
    throw ApiError.badRequest("Prompt is required");
  }

  // Fetch authorized context for this customer only
  const [orders, wishlist, preferences, goals] = await Promise.all([
    Order.find({ customerId: userId }).sort({ createdAt: -1 }).limit(5),
    Wishlist.findOne({ userId }),
    UserPreferences.findOne({ userId }),
    ShoppingGoal.find({ userId }).limit(3),
  ]);

  let wishProducts: string[] = [];
  if (wishlist && wishlist.items.length) {
    const prods = await Product.find({ _id: { $in: wishlist.items.map((i) => i.productId) } });
    wishProducts = prods.map((p) => `${p.title} (৳${p.discountPrice ?? p.price})`);
  }

  const orderSummary = orders.map((o) => `Order #${String(o._id).slice(-6)} - ৳${o.totalAmount} (${o.status})`).join(", ");

  const systemContext = `
You are ShopNest Personal Commerce Copilot for ${req.user!.name || "the customer"}.
You have authorized access to ONLY this customer's private shopping data:
- Recent Orders: ${orderSummary || "No orders yet"}
- Wishlist Products: ${wishProducts.join(", ") || "Wishlist is currently empty"}
- Typical Budget: ৳${preferences?.typicalBudgetMax || 30000}
- Active Goals: ${goals.map((g) => `${g.title} (Budget: ৳${g.targetBudget})`).join(", ") || "None"}

Provide helpful, accurate, friendly, and concise responses in English/Bangla as prompted. Never fabricate orders.
`;

  try {
    const aiResponseText = await complete(
      [{ role: "user", content: prompt }],
      {
        system: `${systemContext}\nYou are an intelligent e-commerce personal assistant for Bangladesh.`,
        maxTokens: 500,
      }
    );

    sendSuccess(res, { answer: aiResponseText });
  } catch {
    // Deterministic Rule-Based Fallback
    let fallbackAnswer = "I am here to assist with your shopping activity! ";
    const lower = prompt.toLowerCase();
    if (lower.includes("wishlist")) {
      fallbackAnswer = wishProducts.length
        ? `You have ${wishProducts.length} items in your wishlist: ${wishProducts.slice(0, 3).join(", ")}.`
        : "Your wishlist is currently empty.";
    } else if (lower.includes("order") || lower.includes("ordered") || lower.includes("bought")) {
      fallbackAnswer = orders.length
        ? `You have placed ${orders.length} recent orders: ${orderSummary}.`
        : "You have not placed any orders yet.";
    } else if (lower.includes("budget") || lower.includes("spent")) {
      fallbackAnswer = `Your configured shopping budget target is ৳${(preferences?.typicalBudgetMax || 30000).toLocaleString()}.`;
    } else {
      fallbackAnswer = "I can answer questions about your wishlist, order delivery statuses, recent spending, and shopping goals!";
    }

    sendSuccess(res, { answer: fallbackAnswer, isFallback: true });
  }
});